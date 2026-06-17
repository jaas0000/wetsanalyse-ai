from datetime import datetime, timedelta, timezone

import pytest

from sqlalchemy import update

from app import db
from app.contracts import BronInput, Feedback, Job, JobState, StartRequest
from app.engine.orchestrator import WetsanalyseEngine
from app.wettenbank import WettenbankError

from conftest import FakeLLM, FakeWettenbank


def _start_req(review: bool) -> StartRequest:
    return StartRequest(bronnen=[BronInput(bwbId="BWBR9999999", artikel="1")], review=review)


async def _set_lease(slug: str, owner: str | None, lease_until) -> None:
    """Test-helper: zet owner/lease_until direct (save_job beheert die velden bewust niet)."""
    async with db.get_engine().begin() as conn:
        await conn.execute(
            update(db.projects).where(db.projects.c.slug == slug)
            .values(owner=owner, lease_until=lease_until)
        )


async def test_autonoom_loopt_door_tot_klaar(engine, store):
    job = await engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)

    job = await store.load_job(job.id)
    assert job.state == JobState.klaar
    rapport = await store.lees_rapport(job.id)
    assert rapport is not None
    assert rapport["bronnen"][0]["markeringen"][0]["klasse"] == "Rechtssubject"
    assert rapport["begrippen"][0]["naam"] == "belastingplichtige"
    assert len(job.provenance) == 2
    assert job.provenance[0].model == "fake-model"


async def test_verwijzingen_in_rapport_met_fetch(engine, store):
    """De cross-referentie-flow: inventaris → fetch → verwijzingen in het rapport, opgehaald."""
    job = await engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)

    rapport = await store.lees_rapport(job.id)
    assert rapport is not None
    verwijzingen = rapport["bronnen"][0]["verwijzingen"]
    assert len(verwijzingen) == 1
    assert verwijzingen[0]["id"] == "v1"
    assert verwijzingen[0]["functie"] == "definitie"
    assert verwijzingen[0]["status"] == "opgehaald"


async def test_verwijzing_fetch_cap_nul_volgt_niet(settings, store):
    """Met cap 0 wordt niets gevolgd: geen extra MCP-fetch, wel de inventaris in de analyse."""
    settings.max_verwijzing_fetches = 0

    class TellendeWb(FakeWettenbank):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def artikel(self, bwb_id, artikel, lid=None):
            self.calls += 1
            return await super().artikel(bwb_id, artikel, lid)

    wb = TellendeWb()
    eng = WetsanalyseEngine(settings, store, FakeLLM(), wb)
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    # Alleen de focus-fetch; geen verwijzing-fetch.
    assert wb.calls == 1
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_verwijzing_fetch_degradeert_zonder_jobfout(settings, store):
    """Een gefaalde verwijzing-fetch mag de job nooit laten falen (best-effort, Niveau B)."""
    class FocusOkVerwijzingStuk(FakeWettenbank):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def artikel(self, bwb_id, artikel, lid=None):
            self.calls += 1
            if self.calls >= 2:  # de gevolgde verwijzing faalt
                raise WettenbankError("verwezen artikel onbereikbaar")
            return await super().artikel(bwb_id, artikel, lid)

    eng = WetsanalyseEngine(settings, store, FakeLLM(), FocusOkVerwijzingStuk())
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    # Ondanks de gefaalde verwijzing-fetch loopt de analyse netjes door.
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_review_pauzeert_en_akkoord_vordert(engine, store):
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)
    assert (await store.load_job(job.id)).state == JobState.wacht_review_act2

    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="2"))
    assert (await store.load_job(job.id)).state == JobState.wacht_review_act3

    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="3"))
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_wijzigingen_maakt_nieuwe_ronde(engine, store):
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)

    await engine.apply_feedback(
        job.id, Feedback(status="wijzigingen", activiteit="2", items={"m1": "herzie de klasse"})
    )
    job = await store.load_job(job.id)
    assert job.state == JobState.wacht_review_act2
    assert job.current_ronde == 2
    assert await store.hoogste_ronde(job.id, "2") == 2


async def test_feedback_buiten_review_doet_niets(engine, store):
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="2"))
    assert (await store.load_job(job.id)).state == JobState.queued


async def test_hallucinatie_faalt_hard(settings, store):
    eng = WetsanalyseEngine(settings, store, FakeLLM(hallucineer=True), FakeWettenbank())
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    job = await store.load_job(job.id)
    assert job.state == JobState.fout
    assert job.error.klasse.value == "validatie"
    assert "Brongetrouwheid" in job.error.bericht


async def test_mcp_fout_faalt(settings, store):
    eng = WetsanalyseEngine(
        settings, store, FakeLLM(), FakeWettenbank(fout=WettenbankError("MCP down"))
    )
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    job = await store.load_job(job.id)
    assert job.state == JobState.fout
    assert job.error.klasse.value == "mcp"


async def test_retry_vanuit_fout(settings, store):
    eng = WetsanalyseEngine(
        settings, store, FakeLLM(), FakeWettenbank(fout=WettenbankError("MCP down"))
    )
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)
    assert (await store.load_job(job.id)).state == JobState.fout

    eng.wb = FakeWettenbank()
    await eng.retry(job.id)
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_bwbid_verplicht(engine):
    with pytest.raises(ValueError):
        await engine.create_job(StartRequest(bronnen=[BronInput(artikel="1")]), "test")


async def test_dubbele_run_initial_geen_dubbele_pickup(engine, store):
    """CAS: een tweede run_initial op een al-geclaimde job is een no-op (geen dubbele generatie)."""
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)
    eerste = await store.load_job(job.id)
    assert eerste.state == JobState.wacht_review_act2
    assert len(eerste.provenance) == 1

    await engine.run_initial(job.id)  # state is niet meer queued → claim mist → niets gebeurt
    tweede = await store.load_job(job.id)
    assert tweede.state == JobState.wacht_review_act2
    assert len(tweede.provenance) == 1


async def test_feedback_na_verloren_race_is_noop(engine, store):
    """Is de review-state al weggeclaimd (andere worker), dan verwerkt apply_feedback niets."""
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)
    # Simuleer dat een andere worker de review-state net wegclaimde.
    await store.claim(job.id, {JobState.wacht_review_act2}, JobState.act2_runt, "andere-worker", 120)

    await engine.apply_feedback(
        job.id, Feedback(status="wijzigingen", activiteit="2", items={"m1": "x"})
    )
    # Geen nieuwe ronde, geen feedback verwerkt (de claim van deze worker miste).
    assert await store.hoogste_ronde(job.id, "2") == 1
    assert await store.lees_feedback(job.id, "2", 1) is None


# --- 1b: lease / reaper / fencing ---

async def test_reaper_ruimt_verlopen_lease_op(engine, store):
    """Een runt-job met verlopen lease (worker weg/gecrasht) wordt door de reaper op fout gezet;
    een verse lease blijft ongemoeid."""
    verleden = datetime.now(timezone.utc) - timedelta(seconds=1)
    toekomst = datetime.now(timezone.utc) + timedelta(seconds=120)
    await store.save_job(Job(id="verweesd", state=JobState.act3_runt, current_activiteit="3"))
    await _set_lease("verweesd", "dode-worker", verleden)
    await store.save_job(Job(id="levend", state=JobState.act2_runt))
    await _set_lease("levend", "levende-worker", toekomst)

    await engine.reap_once()

    verweesd = await store.load_job("verweesd")
    assert verweesd.state == JobState.fout
    assert verweesd.error.klasse.value == "intern"
    assert (await store.load_job("levend")).state == JobState.act2_runt


async def test_reconcile_markeert_lease_loze_runtjob(engine, store):
    """Migratie-vangnet: een runt-job zónder lease (pre-upgrade) wordt door reconcile gemarkeerd
    en daarna door de reaper opgeruimd — hij hangt dus niet eeuwig."""
    await store.save_job(Job(id="pre-upgrade", state=JobState.act2_runt))  # geen owner/lease
    await engine.reconcile_startup()
    await engine.reap_once()
    assert (await store.load_job("pre-upgrade")).state == JobState.fout


async def test_fenced_save_faalt_na_verloren_eigenaarschap(engine, store):
    """Een worker die zijn job aan een ander is verloren, kan met een fenced save niet clobberen."""
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)  # job is nu eigendom van engine.owner
    # Een andere worker kaapt de job (reaper/retry-scenario).
    await store.claim(job.id, {JobState.wacht_review_act2}, JobState.act2_runt, "andere-worker", 120)

    snapshot = await store.load_job(job.id)
    snapshot.state = JobState.klaar  # de oude worker zou willen doorschrijven
    assert await store.save_job(snapshot, owner=engine.owner) is False
    # De fenced write landde niet: de kaper houdt zijn state.
    assert (await store.load_job(job.id)).state == JobState.act2_runt


async def test_max_active_jobs_quota(settings, store):
    """Een client kan niet meer dan max_active_jobs lopende analyses tegelijk starten."""
    from app.ratelimit import QuotaExceeded

    settings.max_active_jobs = 2
    eng = WetsanalyseEngine(settings, store, FakeLLM(), FakeWettenbank())
    await eng.create_job(StartRequest(bronnen=[BronInput(bwbId="BWBR1", artikel="1")]), "klant")
    await eng.create_job(StartRequest(bronnen=[BronInput(bwbId="BWBR1", artikel="2")]), "klant")
    with pytest.raises(QuotaExceeded):
        await eng.create_job(StartRequest(bronnen=[BronInput(bwbId="BWBR1", artikel="3")]), "klant")
    # Een andere client wordt niet geraakt.
    await eng.create_job(StartRequest(bronnen=[BronInput(bwbId="BWBR1", artikel="1")]), "andere-klant")


async def test_token_budget_stopt_job(settings, store):
    """Overschrijdt een analyse het token-budget, dan stopt de job met FoutKlasse.quota."""
    from dataclasses import replace

    from app.llm.base import LLMResult

    class TokenHungryLLM(FakeLLM):
        async def complete(self, system, user, schema=None) -> LLMResult:
            res = await super().complete(system, user, schema)
            return replace(res, tokens_out=1000)

    settings.llm_token_budget = 500
    eng = WetsanalyseEngine(settings, store, TokenHungryLLM(), FakeWettenbank())
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    job = await store.load_job(job.id)
    assert job.state == JobState.fout
    assert job.error.klasse.value == "quota"


async def test_autocorrectie_negeert_zachte_schemafouten(settings, store, monkeypatch):
    """Zachte schemafouten mogen geen (dure) hergeneratie triggeren — alleen brongetrouwheid wel."""
    import app.engine.orchestrator as orch

    settings.max_autocorrectie = 2
    monkeypatch.setattr(orch, "brongetrouwheid_check", lambda d, a: [])
    monkeypatch.setattr(orch, "schema_check", lambda d, a: (["zachte schemafout"], []))

    llm = FakeLLM()
    eng = WetsanalyseEngine(settings, store, llm, FakeWettenbank())
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    # Verwijzing-inventaris (fase 2a) + act2 + act3; geen extra hergeneratie ondanks de zachte fout.
    assert llm.calls == 3
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_transiente_mcp_fout_wordt_geretryed(settings, store):
    """Een transiënte MCP-fout op de eerste poging mag de job niet terminaal laten falen."""
    settings.transient_max_retries = 2
    settings.transient_backoff_s = 0  # geen echte slaap in de test

    class FlakyWettenbank(FakeWettenbank):
        def __init__(self):
            super().__init__()
            self.calls = 0

        async def artikel(self, bwb_id, artikel, lid=None):
            self.calls += 1
            if self.calls == 1:
                raise WettenbankError("MCP-timeout (transiënt)")
            return await super().artikel(bwb_id, artikel, lid)

    wb = FlakyWettenbank()
    eng = WetsanalyseEngine(settings, store, FakeLLM(), wb)
    job = await eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    # 1 mislukte + 1 geslaagde focus-fetch (de retry), plus 1 fetch van de gevolgde verwijzing.
    assert wb.calls == 3
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_create_job_retryt_bij_duplicate(engine, store, monkeypatch):
    """Een IdConflict (gelijktijdige identieke aanmaak) leidt tot een nieuwe poging."""
    from app.jobstore import IdConflict

    echt_insert = store.insert_job
    pogingen = {"n": 0}

    async def flaky_insert(job):
        pogingen["n"] += 1
        if pogingen["n"] == 1:
            raise IdConflict("slug bestaat al")
        await echt_insert(job)

    monkeypatch.setattr(store, "insert_job", flaky_insert)
    job = await engine.create_job(_start_req(review=False), "test")
    assert pogingen["n"] == 2
    assert (await store.load_job(job.id)) is not None


async def test_create_job_uitputting_werpt_idconflict(engine, store, monkeypatch):
    from app.jobstore import IdConflict

    async def altijd_duplicate(job):
        raise IdConflict("slug bestaat al")

    monkeypatch.setattr(store, "insert_job", altijd_duplicate)
    with pytest.raises(IdConflict):
        await engine.create_job(_start_req(review=False), "test")


async def test_current_fase_sequentie(engine, store):
    """De fijnmazige fase-tikken vormen het contract dat het dashboard rendert: act2 (incl.
    verwijzingen) → act3 (zonder verwijzingen) → rapport-bouw, eindigend op None. max_autocorrectie
    is 0 in de testsettings, dus 'auto-correctie' komt hier niet voor."""
    opgenomen: list[str | None] = []

    async def recorder(job_id, fase, owner):
        opgenomen.append(fase)
        return True

    store.set_current_fase = recorder
    job = await engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)

    assert opgenomen == [
        "wettekst-ophalen", "verwijzingen-inventariseren", "verwijzingen-volgen", "llm-generatie",
        "brongetrouwheid-check", "schema-check", "analyse-wegschrijven",
        "llm-generatie", "brongetrouwheid-check", "schema-check", "analyse-wegschrijven",
        "reviewlog", "aandachtspunten", "rapport-wegschrijven", None,
    ]


async def test_current_fase_gewist_bij_review_pauze(engine, store):
    """Bij een review-pauze staat er geen lopende functiefase meer (het dashboard toont dan de
    macro-state, niet een 'bevroren' fase)."""
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)

    p = await store.load_project(job.id)
    assert p.state == JobState.wacht_review_act2
    assert p.current_fase is None
    assert p.current_fase_sinds is None
