"""De orchestrator — bezit de review-lus en de state machine.

Driehoek van garanties:
  - HARD brongetrouwheid faalt → job naar `fout` (ook in review:false). Nooit stil `klaar`.
  - ZACHTE schema-fouten blokkeren niet; ze gaan als waarschuwing mee naar het checkpoint
    (review:true) of worden gelogd (review:false).
  - Auto-correctie is GEEN ronde: her-genereren binnen één ronde, vóór het wegschrijven.
Single-worker + per-job lock serialiseert state-transities.
"""

from __future__ import annotations

import json

from ..config import Settings
from ..contracts import FoutKlasse, Job, JobFout, JobState, RondeProvenance, REVIEW_STATES, StartRequest
from ..llm.base import LLMClient, LLMError
from ..store import Store, lock_for, _atomic_write
from ..validation import brongetrouwheid_check, schema_check
from ..wettenbank import WettenbankClient, WettenbankError, map_artikel_naar_analyse_basis
from . import prompts, steps

BASIS_KEYS = ("wet", "bwbId", "artikel", "versiedatum", "bronreferentie", "pad", "leden")


class WetsanalyseEngine:
    def __init__(self, settings: Settings, store: Store, llm: LLMClient, wb: WettenbankClient) -> None:
        self.s = settings
        self.store = store
        self.llm = llm
        self.wb = wb

    # --- publieke API -----------------------------------------------------

    def create_job(self, req: StartRequest, client_id: str) -> Job:
        if not req.bwbId:
            raise ValueError("bwbId is verplicht in v1 (wet-only resolutie is roadmap).")
        self.s.resolve_profile(req.model_profile)  # werpt KeyError bij onbekend profiel
        job_id = self.store.afgeleid_id(req.bwbId, req.artikel, req.lid)
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
        self.store.save_job(job)
        return job

    async def run_initial(self, job_id: str) -> None:
        async with lock_for(job_id):
            job = self.store.load_job(job_id)
            if job is None or job.state != JobState.queued:
                return
            await self._guard(job, "act2", self._fase_start(job))

    async def apply_feedback(self, job_id: str, feedback) -> None:
        async with lock_for(job_id):
            job = self.store.load_job(job_id)
            if job is None or job.state not in REVIEW_STATES:
                return
            activiteit = "2" if job.state == JobState.wacht_review_act2 else "3"
            ronde = job.current_ronde
            self.store.schrijf_feedback(job.id, activiteit, ronde, feedback)
            await self._guard(job, f"act{activiteit}", self._fase_feedback(job, activiteit, ronde, feedback))

    async def retry(self, job_id: str) -> None:
        async with lock_for(job_id):
            job = self.store.load_job(job_id)
            if job is None or job.state != JobState.fout:
                return
            r2 = self.store.hoogste_ronde(job.id, "2")
            r3 = self.store.hoogste_ronde(job.id, "3")
            job.error = None
            if r3 > 0:
                job.state, job.current_activiteit, job.current_ronde = JobState.wacht_review_act3, "3", r3
                self.store.save_job(job)
            elif r2 > 0:
                job.state, job.current_activiteit, job.current_ronde = JobState.wacht_review_act2, "2", r2
                self.store.save_job(job)
            else:
                job.state = JobState.queued
                self.store.save_job(job)
                await self._guard(job, "act2", self._fase_start(job))

    def reconcile_startup(self) -> None:
        """Na herstart: een job in een runt-state heeft geen lopende taak meer → markeer onderbroken."""
        for job in self.store.list_jobs():
            if job.state in (JobState.act2_runt, JobState.act3_runt, JobState.bouwt):
                self._fail(job, job.state.value, FoutKlasse.intern, "Onderbroken bij herstart van de dienst.")

    # --- fasen (coroutines, uitgevoerd binnen _guard) ---------------------

    async def _fase_start(self, job: Job) -> None:
        job.state = JobState.act2_runt
        self.store.save_job(job)
        artikel_data = await self.wb.artikel(job.bwbId, job.artikel, job.lid)
        basis = map_artikel_naar_analyse_basis(artikel_data)
        await self._genereer(job, "2", 1, basis, vorige=None, feedback=None)

    async def _fase_feedback(self, job: Job, activiteit: str, ronde: int, feedback) -> None:
        if feedback.is_akkoord_zonder_opmerkingen():
            await self._advance_akkoord(job, activiteit)
            return
        if ronde >= self.s.max_rondes:
            # Veiligheidscap: ga door ondanks resterende feedback (resterende punten → aandachtspunten).
            await self._advance_akkoord(job, activiteit)
            return
        job.state = JobState.act2_runt if activiteit == "2" else JobState.act3_runt
        self.store.save_job(job)
        basis = self._basis(job)
        vorige = self.store.lees_analyse(job.id, activiteit, ronde)
        await self._genereer(job, activiteit, ronde + 1, basis, vorige=vorige, feedback=feedback.model_dump())

    async def _advance_akkoord(self, job: Job, activiteit: str) -> None:
        if activiteit == "2":
            job.state = JobState.act3_runt
            self.store.save_job(job)
            basis = self._basis(job)
            act2 = self.store.lees_analyse(job.id, "2", self.store.hoogste_ronde(job.id, "2"))
            await self._genereer(job, "3", 1, basis, vorige=None, feedback=None, act2=act2)
        else:
            await self._bouw_rapport(job)

    # --- generatie van één ronde (incl. auto-correctie) -------------------

    async def _genereer(self, job, activiteit, ronde, basis, vorige, feedback, act2=None) -> None:
        async def maak():
            if feedback is not None:
                return await steps.herzie(self.llm, activiteit, basis, ronde, vorige, feedback)
            if activiteit == "2":
                return await steps.genereer_act2(self.llm, basis, ronde, job.analysefocus or None)
            return await steps.genereer_act3(self.llm, basis, ronde, act2)

        analyse, prov = await maak()
        pogingen = 0
        while pogingen < self.s.max_autocorrectie:
            if not brongetrouwheid_check(analyse, activiteit) and not schema_check(analyse, activiteit)[0]:
                break
            pogingen += 1
            analyse, prov = await maak()

        schendingen = brongetrouwheid_check(analyse, activiteit)
        fouten, waarschuwingen = schema_check(analyse, activiteit)

        self.store.schrijf_analyse(job.id, activiteit, ronde, analyse)
        job.provenance.append(RondeProvenance(**prov))
        job.current_activiteit = activiteit
        job.current_ronde = ronde
        job.waarschuwingen = schendingen + fouten + waarschuwingen
        self.store.save_job(job)

        if schendingen:
            self._fail(
                job, f"act{activiteit}", FoutKlasse.validatie,
                "Brongetrouwheid faalt na auto-correctie: " + "; ".join(schendingen),
            )
            return
        if job.review:
            job.state = JobState.wacht_review_act2 if activiteit == "2" else JobState.wacht_review_act3
            self.store.save_job(job)
            return
        await self._advance_akkoord(job, activiteit)

    # --- rapport ----------------------------------------------------------

    async def _bouw_rapport(self, job: Job) -> None:
        from ..rapport import bouw_rapport

        job.state = JobState.bouwt
        self.store.save_job(job)
        rapport = bouw_rapport(
            self.store.werk_dir(job.id),
            reviewlog_act2=self._reviewlog(job, "2"),
            reviewlog_act3=self._reviewlog(job, "3"),
            aandachtspunten=self._aandachtspunten(job),
        )
        _atomic_write(self.store.rapport_pad(job.id), json.dumps(rapport, ensure_ascii=False, indent=2))
        job.state = JobState.klaar
        self.store.save_job(job)

    def _reviewlog(self, job: Job, activiteit: str) -> str:
        n = self.store.hoogste_ronde(job.id, activiteit)
        if not job.review:
            return f"Review overgeslagen (review:false); {n} ronde(n) autonoom gegenereerd."
        if n <= 1:
            return "1 ronde — direct akkoord, geen wijzigingen."
        return f"{n} rondes — feedback per ronde verwerkt tot akkoord."

    def _aandachtspunten(self, job: Job) -> str:
        a3 = self.store.lees_analyse(job.id, "3", self.store.hoogste_ronde(job.id, "3")) or {}
        punten = list(a3.get("validatiepunten") or [])
        for b in a3.get("begrippen", []) + a3.get("afleidingsregels", []):
            if (b.get("twijfel") or "").strip():
                punten.append(f"{b.get('naam', b.get('id', '?'))}: {b['twijfel']}")
        if job.waarschuwingen:
            punten.append("Mechanische waarschuwingen: " + "; ".join(job.waarschuwingen))
        return "\n".join(f"- {p}" for p in punten) if punten else ""

    # --- helpers ----------------------------------------------------------

    def _basis(self, job: Job) -> dict:
        a2 = self.store.lees_analyse(job.id, "2", 1) or {}
        return {k: a2.get(k) for k in BASIS_KEYS}

    def _fail(self, job: Job, stap: str, klasse: FoutKlasse, bericht: str) -> None:
        job.state = JobState.fout
        job.error = JobFout(stap=stap, ronde=job.current_ronde or None, klasse=klasse, bericht=bericht)
        self.store.save_job(job)

    async def _guard(self, job: Job, stap: str, coro) -> None:
        """Voer een fase uit en vertaal faalklassen naar een terminale `fout`-state."""
        try:
            await coro
        except WettenbankError as e:
            self._fail(job, stap, FoutKlasse.mcp, str(e))
        except LLMError as e:
            self._fail(job, stap, FoutKlasse.llm, str(e))
        except Exception as e:  # noqa: BLE001
            self._fail(job, stap, FoutKlasse.intern, f"{type(e).__name__}: {e}")
