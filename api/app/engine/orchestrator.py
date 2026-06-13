"""De orchestrator — bezit de review-lus en de state machine.

Driehoek van garanties:
  - HARD brongetrouwheid faalt → job naar `fout` (ook in review:false). Nooit stil `klaar`.
  - ZACHTE schema-fouten blokkeren niet; ze gaan als waarschuwing mee naar het checkpoint
    (review:true) of worden gelogd (review:false).
  - Auto-correctie is GEEN ronde: her-genereren binnen één ronde, vóór het wegschrijven.
De jobstore is MongoDB (gedeeld). State-transities worden geserialiseerd met een atomaire
**Mongo state-CAS** (`store.claim`): alleen de transitie NAAR een runt-state hoeft atomair,
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
    REVIEW_STATES, RUNNING_STATES, TERMINAL_STATES, StartRequest,
)
from ..llm.base import LLMClient, LLMError
from ..llm.litellm_client import build_llm_client
from .. import profiles
from ..jobstore import IdConflict, JobStore
from ..ratelimit import QuotaExceeded
from ..rapport import bouw_rapport_async
from ..validation import brongetrouwheid_check, schema_check
from ..wettenbank import WettenbankClient, WettenbankError, map_artikel_naar_analyse_basis
from . import prompts, steps
from .retry import met_retry

logger = logging.getLogger(__name__)

BASIS_KEYS = ("wet", "bwbId", "artikel", "versiedatum", "bronreferentie", "pad", "leden")


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
        """Maak een Project-document aan zonder de analyse te starten."""
        from pymongo.errors import DuplicateKeyError

        from ..project import Project as ProjectDoc
        if not req.bwbId:
            raise ValueError("bwbId is verplicht in v1 (wet-only resolutie is roadmap).")
        if req.model_profile:
            await profiles.ensure_exists(req.model_profile)
        await self._check_active_quota(client_id)
        naam = req.naam or f"Art. {req.artikel}{f' lid {req.lid}' if req.lid else ''}"
        # Begrensde retry: twee gelijktijdige identieke POSTs kunnen dezelfde vrije slug zien;
        # de unique index laat er één winnen, de ander leidt een nieuwe slug af.
        for _ in range(5):
            slug = await self.store.afgeleid_id(req.bwbId, req.artikel, req.lid)
            project = ProjectDoc(
                slug=slug,
                naam=naam,
                omschrijving=req.omschrijving,
                bwbId=req.bwbId,
                artikel=req.artikel,
                lid=req.lid,
                review=req.review,
                model_profile=req.model_profile or self.s.default_model_profile,
                analysefocus=req.analysefocus or "",
                client_id=client_id,
            )
            try:
                await project.insert()
                return project
            except DuplicateKeyError:
                continue
        raise IdConflict("Kon geen uniek project-id reserveren; probeer opnieuw.")

    async def create_job(self, req: StartRequest, client_id: str) -> Job:
        from pymongo.errors import DuplicateKeyError

        if not req.bwbId:
            raise ValueError("bwbId is verplicht in v1 (wet-only resolutie is roadmap).")
        if req.model_profile:
            await profiles.ensure_exists(req.model_profile)
        await self._check_active_quota(client_id)
        # Begrensde retry tegen de gelijktijdige-aanmaak-race (zie create_project). insert_job
        # maakt altijd een nieuw document, zodat de tweede POST geen bestaand project overschrijft.
        for _ in range(5):
            job_id = await self.store.afgeleid_id(req.bwbId, req.artikel, req.lid)
            job = Job(
                id=job_id,
                state=JobState.queued,
                bwbId=req.bwbId,
                artikel=req.artikel,
                lid=req.lid,
                review=req.review,
                model_profile=req.model_profile or self.s.default_model_profile,
                analysefocus=req.analysefocus or "",
                client_id=client_id,
            )
            try:
                await self.store.insert_job(job)
                return job
            except DuplicateKeyError:
                continue
        raise IdConflict("Kon geen uniek analyse-id reserveren; probeer opnieuw.")

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
        artikel_data = await self._met_retry(lambda: self.wb.artikel(job.bwbId, job.artikel, job.lid))
        basis = map_artikel_naar_analyse_basis(artikel_data)
        await self._genereer(job, "2", 1, basis, vorige=None, feedback=None)

    async def _fase_feedback(self, job: Job, activiteit: str, ronde: int, feedback) -> None:
        if feedback.is_akkoord_zonder_opmerkingen():
            await self._advance_akkoord(job, activiteit)
            return
        if ronde >= self.s.max_rondes:
            await self._advance_akkoord(job, activiteit)
            return
        job.state = JobState.act2_runt if activiteit == "2" else JobState.act3_runt
        await self._save(job)
        basis = await self._basis(job)
        vorige = await self.store.lees_analyse(job.id, activiteit, ronde)
        await self._genereer(job, activiteit, ronde + 1, basis, vorige=vorige, feedback=feedback.model_dump())

    async def _advance_akkoord(self, job: Job, activiteit: str) -> None:
        if activiteit == "2":
            job.state = JobState.act3_runt
            await self._save(job)
            basis = await self._basis(job)
            n = await self.store.hoogste_ronde(job.id, "2")
            act2 = await self.store.lees_analyse(job.id, "2", n)
            await self._genereer(job, "3", 1, basis, vorige=None, feedback=None, act2=act2)
        else:
            await self._bouw_rapport(job)

    # --- generatie van één ronde (incl. auto-correctie) -------------------

    async def _genereer(self, job, activiteit, ronde, basis, vorige, feedback, act2=None) -> None:
        if self.s.llm_token_budget > 0:
            gebruikt = sum(p.tokens_in + p.tokens_out for p in job.provenance)
            if gebruikt >= self.s.llm_token_budget:
                await self._fail(
                    job, f"act{activiteit}", FoutKlasse.quota,
                    f"LLM-tokenbudget ({self.s.llm_token_budget}) overschreden na {gebruikt} tokens.",
                )
                return

        llm = await self._llm_for(job)

        async def maak():
            if feedback is not None:
                return await steps.herzie(llm, activiteit, basis, ronde, vorige, feedback)
            if activiteit == "2":
                return await steps.genereer_act2(llm, basis, ronde, job.analysefocus or None)
            return await steps.genereer_act3(llm, basis, ronde, act2)

        analyse, prov = await self._met_retry(maak)
        pogingen = 0
        # Auto-correctie regenereert UITSLUITEND op harde brongetrouwheid-schendingen. Zachte
        # schema-fouten blokkeren per ontwerp niet en mogen geen (dure) hergeneratie triggeren;
        # ze reizen als waarschuwing mee naar het checkpoint.
        while pogingen < self.s.max_autocorrectie and brongetrouwheid_check(analyse, activiteit):
            pogingen += 1
            analyse, prov = await self._met_retry(maak)

        schendingen = brongetrouwheid_check(analyse, activiteit)
        fouten, waarschuwingen = schema_check(analyse, activiteit)

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
            return
        await self._advance_akkoord(job, activiteit)

    # --- rapport ----------------------------------------------------------

    async def _bouw_rapport(self, job: Job) -> None:
        job.state = JobState.bouwt
        await self._save(job)
        rapport = await bouw_rapport_async(
            self.store,
            job.id,
            reviewlog_act2=await self._reviewlog(job, "2"),
            reviewlog_act3=await self._reviewlog(job, "3"),
            aandachtspunten=await self._aandachtspunten(job),
        )
        await self.store.schrijf_rapport(job.id, rapport)
        job.state = JobState.klaar
        await self._save(job)

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

    async def _check_active_quota(self, client_id: str) -> None:
        """Weiger een nieuwe analyse als de client al te veel lopende (niet-terminale) heeft."""
        if self.s.max_active_jobs <= 0:
            return
        jobs = await self.store.list_jobs(client_id)
        actief = sum(1 for j in jobs if j.state not in TERMINAL_STATES)
        if actief >= self.s.max_active_jobs:
            raise QuotaExceeded(
                f"Te veel lopende analyses (max {self.s.max_active_jobs}); wacht tot er één klaar is."
            )

    async def _met_retry(self, maak):
        """Bounded retry op transiënte LLM/MCP-fouten met de geconfigureerde knoppen."""
        return await met_retry(
            maak,
            max_retries=self.s.transient_max_retries,
            backoff=self.s.transient_backoff_s,
            max_backoff=self.s.transient_max_backoff_s,
        )

    async def _basis(self, job: Job) -> dict:
        a2 = await self.store.lees_analyse(job.id, "2", 1) or {}
        return {k: a2.get(k) for k in BASIS_KEYS}

    async def _fail(self, job: Job, stap: str, klasse: FoutKlasse, bericht: str) -> None:
        job.state = JobState.fout
        job.error = JobFout(stap=stap, ronde=job.current_ronde or None, klasse=klasse, bericht=bericht)
        await self.store.save_job(job)

    async def _save(self, job: Job) -> None:
        """Fenced state-write: schrijft alleen als deze worker de job nog bezit. Verloren lease
        (bv. door een reaper-claim) → LeaseVerloren, zodat de fase stopt i.p.v. een andere worker
        te overschrijven."""
        if not await self.store.save_job(job, owner=self.owner):
            raise LeaseVerloren(job.id)

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
