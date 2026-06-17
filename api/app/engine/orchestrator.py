"""De orchestrator — bezit de review-lus en de state machine.

Driehoek van garanties:
  - HARD brongetrouwheid faalt → job naar `fout` (ook in review:false). Nooit stil `klaar`.
  - ZACHTE schema-fouten blokkeren niet; ze gaan als waarschuwing mee naar het checkpoint
    (review:true) of worden gelogd (review:false).
  - Auto-correctie is GEEN ronde: her-genereren binnen één ronde, vóór het wegschrijven.
De jobstore is PostgreSQL (gedeeld). State-transities worden geserialiseerd met een atomaire
**state-CAS** (`store.claim`, één UPDATE … RETURNING): alleen de transitie NAAR een runt-state hoeft atomair,
de runt-state zelf is daarna de 'claimed'-marker zodat geen tweede worker dezelfde job oppakt.
Dit vervangt de vroegere in-process asyncio-lock en maakt de dienst **horizontaal schaalbaar**
(>1 worker/replica). Een geclaimde job draagt een `owner` + `lease_until`; de owner houdt de
lease vers via een heartbeat (`_guard`), schrijft alleen fenced (`_save`, conditioneel op nog-
eigenaar-zijn), en een periodieke reaper (`reap_once`) ruimt jobs met een verlopen lease op.
"""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from ..config import Settings
from ..contracts import (
    FoutKlasse, Job, JobFout, JobState, RondeProvenance,
    REVIEW_STATES, RUNNING_STATES, StartRequest,
)
from ..llm.base import LLMClient, LLMError
from ..llm.litellm_client import build_llm_client
from .. import profiles
from ..jobstore import IdConflict, JobStore
from ..rapport import bouw_rapport_async
from ..validation import brongetrouwheid_check, schema_check
from ..wettenbank import WettenbankClient, WettenbankError, map_artikel_naar_bron_basis, parse_jci
from . import prompts, steps
from .retry import met_retry

logger = logging.getLogger(__name__)


def _seed(req: StartRequest) -> str:
    """Slug-seed voor het werkgebied: de naam, of een afleiding van de eerste bron."""
    if req.naam:
        return req.naam
    b = req.bronnen[0]
    lid = f"-lid{b.lid}" if b.lid else ""
    return f"{(b.bwbId or '').lower()}-art{(b.artikel or '').lower().replace(' ', '')}{lid}"


def _naam(req: StartRequest) -> str:
    if req.naam:
        return req.naam
    b = req.bronnen[0]
    extra = f" e.a. ({len(req.bronnen)} bronnen)" if len(req.bronnen) > 1 else ""
    return f"Art. {b.artikel}{f' lid {b.lid}' if b.lid else ''}{extra}"


class LeaseVerloren(Exception):
    """De worker is zijn lease/eigenaarschap kwijt (bv. door een reaper-claim). De fase moet
    stoppen zonder verder te schrijven — een andere worker bezit de job nu."""


class WetsanalyseEngine:
    def __init__(self, settings: Settings, store: JobStore, llm: LLMClient | None, wb: WettenbankClient) -> None:
        self.s = settings
        self.store = store
        # Een geïnjecteerde client (tests/eval) overschrijft profiel-resolutie; in productie is
        # dit None en bouwt de engine per analyse een client uit het profiel van de job.
        self._llm_override = llm
        self.wb = wb
        # Per-proces id: identificeert deze worker als eigenaar van een geclaimde job. Eén engine
        # per proces (deps.get_engine is @lru_cache), dus dit id is stabiel binnen de worker.
        self.owner = uuid4().hex

    async def _llm_for(self, job: Job) -> LLMClient:
        if self._llm_override is not None:
            return self._llm_override
        cfg = await profiles.resolve_config(job.model_profile, self.s)
        return build_llm_client(cfg)

    # --- publieke API -----------------------------------------------------

    async def create_project(self, req: StartRequest, client_id: str):
        """Maak een Project (werkgebied met ≥1 bron) aan zonder de analyse te starten."""
        from ..project import Project as ProjectDoc
        self._valideer_bronnen(req)
        if req.model_profile:
            await profiles.ensure_exists(req.model_profile)
        # Begrensde retry: twee gelijktijdige identieke POSTs kunnen dezelfde vrije slug zien;
        # de unieke sleutel laat er één winnen, de ander leidt een nieuwe slug af (IdConflict).
        for _ in range(5):
            slug = await self.store.afgeleid_id(_seed(req))
            project = ProjectDoc(
                slug=slug,
                naam=_naam(req),
                omschrijving=req.omschrijving,
                bronnen=list(req.bronnen),
                review=req.review,
                model_profile=req.model_profile or self.s.default_model_profile,
                analysefocus=req.analysefocus or "",
                client_id=client_id,
            )
            try:
                await self.store.create_project(project, max_active=self.s.max_active_jobs)
                return project
            except IdConflict:
                continue
        raise IdConflict("Kon geen uniek project-id reserveren; probeer opnieuw.")

    async def create_job(self, req: StartRequest, client_id: str) -> Job:
        self._valideer_bronnen(req)
        if req.model_profile:
            await profiles.ensure_exists(req.model_profile)
        # Begrensde retry tegen de gelijktijdige-aanmaak-race (zie create_project). insert_job
        # maakt altijd een nieuw document, zodat de tweede POST geen bestaand project overschrijft.
        for _ in range(5):
            job_id = await self.store.afgeleid_id(_seed(req))
            job = Job(
                id=job_id,
                state=JobState.queued,
                naam=_naam(req),
                bronnen=list(req.bronnen),
                review=req.review,
                model_profile=req.model_profile or self.s.default_model_profile,
                analysefocus=req.analysefocus or "",
                client_id=client_id,
            )
            try:
                await self.store.insert_job(job, max_active=self.s.max_active_jobs)
                return job
            except IdConflict:
                continue
        raise IdConflict("Kon geen uniek analyse-id reserveren; probeer opnieuw.")

    @staticmethod
    def _valideer_bronnen(req: StartRequest) -> None:
        if not req.bronnen:
            raise ValueError("Minstens één bron is verplicht.")
        for b in req.bronnen:
            if not b.bwbId:
                raise ValueError("bwbId is verplicht per bron (wet-only resolutie is roadmap).")

    async def run_initial(self, job_id: str) -> None:
        # CAS: claim queued → act2_runt. Faalt de claim, dan is de job al opgepakt/voorbij —
        # geen tweede worker pakt 'm op (de runt-state is de 'claimed'-marker).
        job = await self.store.claim(job_id, {JobState.queued}, JobState.act2_runt, self.owner, self.s.lease_s)
        if job is None:
            return
        await self._guard(job, "act2", self._fase_start(job))

    async def apply_feedback(self, job_id: str, feedback) -> None:
        job = await self.store.load_job(job_id)
        if job is None or job.state not in REVIEW_STATES:
            return
        activiteit = "2" if job.state == JobState.wacht_review_act2 else "3"
        naar = JobState.act2_runt if activiteit == "2" else JobState.act3_runt
        # Claim de review-state atomair → runt; pas NA een geslaagde claim schrijven we de
        # feedback (een verloren race schrijft dan geen feedback).
        claimed = await self.store.claim(job_id, {job.state}, naar, self.owner, self.s.lease_s)
        if claimed is None:
            return
        ronde = claimed.current_ronde
        await self.store.schrijf_feedback(claimed.id, activiteit, ronde, feedback)
        await self._guard(claimed, f"act{activiteit}", self._fase_feedback(claimed, activiteit, ronde, feedback))

    async def retry(self, job_id: str) -> None:
        job = await self.store.load_job(job_id)
        if job is None or job.state != JobState.fout:
            return
        r2 = await self.store.hoogste_ronde(job.id, "2")
        r3 = await self.store.hoogste_ronde(job.id, "3")
        # Doelstate vóór de claim bepalen. Een verse job (geen rondes) gaat direct naar act2_runt
        # i.p.v. via een queued-tussenstap, zodat er geen venster is waarin niets de job claimt.
        if r3 > 0:
            naar, activiteit, ronde = JobState.wacht_review_act3, "3", r3
        elif r2 > 0:
            naar, activiteit, ronde = JobState.wacht_review_act2, "2", r2
        else:
            naar, activiteit, ronde = JobState.act2_runt, None, 0
        claimed = await self.store.claim(job_id, {JobState.fout}, naar, self.owner, self.s.lease_s)
        if claimed is None:
            return
        try:
            claimed.error = None
            if activiteit is not None:
                claimed.current_activiteit, claimed.current_ronde = activiteit, ronde
            await self.store.save_job(claimed)
        except Exception:  # noqa: BLE001 — laat de job in een herstelbare state i.p.v. stil hangen
            logger.exception("Retry van job %s kon de state niet herstellen", job_id)
            return
        if naar == JobState.act2_runt:
            await self._guard(claimed, "act2", self._fase_start(claimed))

    async def reconcile_startup(self) -> None:
        """Migratie-/herstelvangnet bij opstart. Onder >1 replica mag een opstartende worker NIET
        zomaar alle runt-jobs doodverklaren (die kunnen van een levende collega zijn). We geven
        daarom alleen runt-jobs *zonder* lease (pre-upgrade of een crash waarbij het lease-veld
        nooit gezet werd) een verlopen lease, zodat de reaper ze opruimt. Jobs met een geldige
        lease blijven ongemoeid; verloopt die lease, dan pakt de reaper ze alsnog op."""
        n = await self.store.markeer_lease_loze_running()
        if n:
            logger.info("Reconcile: %d lease-loze runt-job(s) gemarkeerd voor de reaper.", n)

    async def reap_once(self) -> None:
        """Eén reaper-ronde: claim elke runt-job met een verlopen lease naar `fout`. De claim is
        atomair én vereist een verlopen lease, dus een job van een levende worker (verse lease)
        wordt nooit gekaapt."""
        for job_id in await self.store.lijst_verlopen_running():
            claimed = await self.store.claim(
                job_id, RUNNING_STATES, JobState.fout, self.owner, self.s.lease_s,
                vereist_verlopen_lease=True,
            )
            if claimed is None:
                continue  # lease intussen verlengd of al opgepakt door een andere reaper
            logger.warning("Reaper: job %s had een verlopen lease → fout (onderbroken).", job_id)
            await self._fail(claimed, claimed.current_activiteit or "intern", FoutKlasse.intern,
                             "Onderbroken: lease verlopen (worker weg of gecrasht).")

    # --- fasen (coroutines, uitgevoerd binnen _guard) ---------------------

    async def _fase_start(self, job: Job) -> None:
        job.state = JobState.act2_runt
        await self._save(job)
        await self._set_fase(job, "wettekst-ophalen")
        # Haal per bron de letterlijke tekst op (deterministisch, via de MCP). Eén bron met een
        # MCP-mis laat de hele job falen (brongetrouwheid) — geen stille lege context.
        bron_bases: list[dict] = []
        for i, b in enumerate(job.bronnen, 1):
            data = await self._met_retry(lambda b=b: self.wb.artikel(b.bwbId, b.artikel, b.lid))
            bron_bases.append(map_artikel_naar_bron_basis(data, f"br{i}", b.lid))
        await self._genereer_act2_vers(job, 1, bron_bases)

    async def _fase_feedback(self, job: Job, activiteit: str, ronde: int, feedback) -> None:
        if feedback.is_akkoord_zonder_opmerkingen() or ronde >= self.s.max_rondes:
            await self._advance_akkoord(job, activiteit)
            return
        job.state = JobState.act2_runt if activiteit == "2" else JobState.act3_runt
        await self._save(job)
        llm = await self._llm_for(job)
        vorige = await self.store.lees_analyse(job.id, activiteit, ronde) or {}
        # Context voor de merge: act-2 herziet op de brongetrouwe bronnen van ronde 1; act-3 op
        # de vorige act-3 (werkgebied + bron-index).
        context = (await self._context_act2(job)) if activiteit == "2" else vorige
        fb = feedback.model_dump()

        async def maak():
            return await steps.herzie(llm, activiteit, context, ronde + 1, vorige, fb)

        await self._afronden_ronde(job, activiteit, ronde + 1, maak)

    async def _advance_akkoord(self, job: Job, activiteit: str) -> None:
        if activiteit == "2":
            job.state = JobState.act3_runt
            await self._save(job)
            llm = await self._llm_for(job)
            act2 = await self._context_act2(job)

            async def maak():
                return await steps.genereer_act3(llm, 1, act2)

            await self._afronden_ronde(job, "3", 1, maak)
        else:
            await self._bouw_rapport(job)

    # --- generatie van één ronde (incl. auto-correctie) -------------------

    def _werkgebied(self, job: Job) -> dict:
        return {"naam": job.naam, "hoofdvraag": job.analysefocus or "", "omschrijving": "", "scoping": ""}

    async def _context_act2(self, job: Job) -> dict:
        """De act-2-aggregaat van ronde 1 (brongetrouwe bronnen) — context voor act-3 en revise."""
        return await self.store.lees_analyse(job.id, "2", 1) or {}

    async def _genereer_act2_vers(self, job: Job, ronde: int, bron_bases: list[dict]) -> None:
        """Verse act-2: per bron de verwijzing-inventaris (fase 2a) + begrensde fetch (één keer),
        daarna per bron markeren/classificeren en tot één werkgebied-aggregaat samenvoegen."""
        llm = await self._llm_for(job)
        per_bron: list[tuple[dict, dict, dict]] = []
        inv_in = inv_out = 0
        for bb in bron_bases:
            await self._set_fase(job, "verwijzingen-inventariseren")
            inv_res = await self._met_retry(lambda bb=bb: steps.inventariseer_verwijzingen(llm, bb))
            inv_in += inv_res.tokens_in
            inv_out += inv_res.tokens_out
            await self._set_fase(job, "verwijzingen-volgen")
            opgehaald = await self._volg_verwijzingen(bb, inv_res.data)
            per_bron.append((bb, inv_res.data, opgehaald))

        async def maak():
            bronnen, tin, tout, prov0 = [], 0, 0, None
            for bb, inv, opg in per_bron:
                bron_dict, prov = await steps.genereer_act2_bron(
                    llm, bb, ronde, job.analysefocus or None, inv, opg
                )
                bronnen.append(bron_dict)
                tin += prov["tokens_in"]
                tout += prov["tokens_out"]
                prov0 = prov0 or prov
            analyse = {
                "werkgebied": self._werkgebied(job),
                "analysefocus": job.analysefocus or "",
                "bronnen": bronnen,
            }
            prov = dict(prov0 or {})
            prov["tokens_in"], prov["tokens_out"] = tin, tout
            return analyse, prov

        await self._afronden_ronde(job, "2", ronde, maak, extra_tokens=(inv_in, inv_out))

    async def _afronden_ronde(self, job: Job, activiteit: str, ronde: int, maak, extra_tokens=(0, 0)) -> None:
        """Gemeenschappelijke afronding van één ronde: budget-check, auto-correctie op harde
        brongetrouwheid, schema-check, wegschrijven, en de state-overgang (review of door)."""
        if self.s.llm_token_budget > 0:
            gebruikt = sum(p.tokens_in + p.tokens_out for p in job.provenance)
            if gebruikt >= self.s.llm_token_budget:
                await self._fail(
                    job, f"act{activiteit}", FoutKlasse.quota,
                    f"LLM-tokenbudget ({self.s.llm_token_budget}) overschreden na {gebruikt} tokens.",
                )
                return

        await self._set_fase(job, "llm-generatie")
        analyse, prov = await self._met_retry(maak)
        pogingen = 0
        # Auto-correctie regenereert UITSLUITEND op harde brongetrouwheid-schendingen.
        while pogingen < self.s.max_autocorrectie and brongetrouwheid_check(analyse, activiteit):
            pogingen += 1
            await self._set_fase(job, "auto-correctie")
            analyse, prov = await self._met_retry(maak)
        # Tel eenmalig de inventaris-tokens (fase 2a) bij de ronde — budget/usage-aggregatie.
        prov["tokens_in"] += extra_tokens[0]
        prov["tokens_out"] += extra_tokens[1]

        await self._set_fase(job, "brongetrouwheid-check")
        schendingen = brongetrouwheid_check(analyse, activiteit)
        await self._set_fase(job, "schema-check")
        fouten, waarschuwingen = schema_check(analyse, activiteit)

        await self._set_fase(job, "analyse-wegschrijven")
        await self.store.schrijf_analyse(job.id, activiteit, ronde, analyse)
        job.provenance.append(RondeProvenance(**prov))
        job.current_activiteit = activiteit
        job.current_ronde = ronde
        job.waarschuwingen = schendingen + fouten + waarschuwingen
        await self._save(job)

        if schendingen:
            await self._fail(
                job, f"act{activiteit}", FoutKlasse.validatie,
                "Brongetrouwheid faalt na auto-correctie: " + "; ".join(schendingen),
            )
            return
        if job.review:
            job.state = JobState.wacht_review_act2 if activiteit == "2" else JobState.wacht_review_act3
            await self._save(job)
            await self._set_fase(job, None)  # wachtstate: geen lopende functiefase
            return
        await self._advance_akkoord(job, activiteit)

    # --- rapport ----------------------------------------------------------

    async def _bouw_rapport(self, job: Job) -> None:
        job.state = JobState.bouwt
        await self._save(job)
        await self._set_fase(job, "reviewlog")
        reviewlog_act2 = await self._reviewlog(job, "2")
        reviewlog_act3 = await self._reviewlog(job, "3")
        await self._set_fase(job, "aandachtspunten")
        aandachtspunten = await self._aandachtspunten(job)
        await self._set_fase(job, "rapport-wegschrijven")
        rapport = await bouw_rapport_async(
            self.store,
            job.id,
            reviewlog_act2=reviewlog_act2,
            reviewlog_act3=reviewlog_act3,
            aandachtspunten=aandachtspunten,
        )
        await self.store.schrijf_rapport(job.id, rapport)
        job.state = JobState.klaar
        await self._save(job)
        await self._set_fase(job, None)  # terminaal: geen lopende functiefase

    async def _reviewlog(self, job: Job, activiteit: str) -> str:
        n = await self.store.hoogste_ronde(job.id, activiteit)
        if not job.review:
            return f"Review overgeslagen (review:false); {n} ronde(n) autonoom gegenereerd."
        if n <= 1:
            return "1 ronde — direct akkoord, geen wijzigingen."
        return f"{n} rondes — feedback per ronde verwerkt tot akkoord."

    async def _aandachtspunten(self, job: Job) -> str:
        n = await self.store.hoogste_ronde(job.id, "3")
        a3 = await self.store.lees_analyse(job.id, "3", n) or {}
        punten = list(a3.get("validatiepunten") or [])
        for b in a3.get("begrippen", []) + a3.get("afleidingsregels", []):
            if (b.get("twijfel") or "").strip():
                punten.append(f"{b.get('naam', b.get('id', '?'))}: {b['twijfel']}")
        if job.waarschuwingen:
            punten.append("Mechanische waarschuwingen: " + "; ".join(job.waarschuwingen))
        return "\n".join(f"- {p}" for p in punten) if punten else ""

    # --- helpers ----------------------------------------------------------

    async def _met_retry(self, maak):
        """Bounded retry op transiënte LLM/MCP-fouten met de geconfigureerde knoppen."""
        return await met_retry(
            maak,
            max_retries=self.s.transient_max_retries,
            backoff=self.s.transient_backoff_s,
            max_backoff=self.s.transient_max_backoff_s,
        )

    async def _volg_verwijzingen(self, basis: dict, inventaris: dict) -> dict:
        """Niveau B — haal de te-volgen verwijzingen op (diepte 1, begrensd tot de fetch-cap).
        Een gefaalde fetch degradeert STIL: de verwijzing blijft 'gesignaleerd', de job faalt
        nooit op een verwezen artikel. Retourneert {target: opgehaalde tekst} als act-2b-context.
        """
        cap = self.s.max_verwijzing_fetches
        if cap <= 0:
            return {}
        opgehaald: dict[str, str] = {}
        gezien: set[tuple] = set()
        for v in (inventaris.get("verwijzingen") or []):
            if len(opgehaald) >= cap:
                break
            if not v.get("volgen"):
                continue
            doel = v.get("doel") or {}
            parsed = parse_jci(doel.get("target") or "")
            if parsed is None:
                continue
            bwb, artikel, lid = parsed
            sleutel = (bwb.upper(), artikel, lid)
            if sleutel in gezien:
                continue
            gezien.add(sleutel)
            try:
                data = await self.wb.artikel(bwb, artikel, lid)
            except Exception as e:  # noqa: BLE001 — best-effort; nooit de job laten falen
                logger.info("Verwijzing-fetch %s art %s overgeslagen: %s", bwb, artikel, e)
                continue
            teksten = [f"Lid {l.get('lid','')}: {l.get('tekst','')}".strip()
                       for l in (data.get("leden") or []) if l.get("tekst")]
            if teksten:
                label = doel.get("target") or f"{bwb} artikel {artikel}"
                opgehaald[label] = "\n".join(teksten)
        return opgehaald

    async def _fail(self, job: Job, stap: str, klasse: FoutKlasse, bericht: str) -> None:
        job.state = JobState.fout
        job.error = JobFout(stap=stap, ronde=job.current_ronde or None, klasse=klasse, bericht=bericht)
        await self.store.save_job(job)
        await self._set_fase(job, None)  # fout: geen lopende functiefase meer tonen

    async def _save(self, job: Job) -> None:
        """Fenced state-write: schrijft alleen als deze worker de job nog bezit. Verloren lease
        (bv. door een reaper-claim) → LeaseVerloren, zodat de fase stopt i.p.v. een andere worker
        te overschrijven."""
        if not await self.store.save_job(job, owner=self.owner):
            raise LeaseVerloren(job.id)

    async def _set_fase(self, job: Job, fase: str | None) -> None:
        """Observerende fase-tik voor het live dashboard (zie PostgresStore.set_current_fase). Strikt
        BEST-EFFORT: een verloren lease (False) of welke fout dan ook breekt de analyse NIET af en
        verandert de control-flow niet — de fase is puur diagnostisch. De canonieke fase-strings
        worden 1-op-1 gespiegeld in frontend/lib/fasen.ts."""
        try:
            await self.store.set_current_fase(job.id, fase, self.owner)
        except Exception:  # noqa: BLE001 — observerend; nooit de analyse laten struikelen
            logger.debug("Fase-tik %r voor %s overgeslagen.", fase, job.id, exc_info=True)

    async def _heartbeat(self, job_id: str) -> None:
        """Houd de lease vers terwijl de fase loopt, zodat de reaper een levende job niet kaapt.
        Tikt op lease_s/2. Raakt de owner de job kwijt, dan stopt de heartbeat; de eerstvolgende
        fenced `_save` breekt de fase dan netjes af."""
        interval = max(self.s.lease_s / 2, 1)
        try:
            while True:
                await asyncio.sleep(interval)
                if not await self.store.verleng_lease(job_id, self.owner, self.s.lease_s):
                    return
        except asyncio.CancelledError:
            return

    async def _guard(self, job: Job, stap: str, coro) -> None:
        """Voer een fase uit (met lease-heartbeat) en vertaal faalklassen naar een terminale
        `fout`-state. Verliest de worker zijn lease, dan stopt de fase zonder de job te raken."""
        hb = asyncio.create_task(self._heartbeat(job.id))
        try:
            await coro
        except LeaseVerloren:
            logger.warning("Job %s: lease verloren tijdens %s — afgebroken (andere worker bezit "
                           "de job nu).", job.id, stap)
        except WettenbankError as e:
            logger.warning("Job %s faalt op %s (MCP): %s", job.id, stap, e)
            await self._fail(job, stap, FoutKlasse.mcp, str(e))
        except LLMError as e:
            logger.warning("Job %s faalt op %s (LLM): %s", job.id, stap, e)
            await self._fail(job, stap, FoutKlasse.llm, str(e))
        except Exception as e:  # noqa: BLE001
            logger.exception("Job %s faalt op %s (intern)", job.id, stap)
            await self._fail(job, stap, FoutKlasse.intern, f"{type(e).__name__}: {e}")
        finally:
            hb.cancel()
            try:
                await hb
            except asyncio.CancelledError:
                pass
