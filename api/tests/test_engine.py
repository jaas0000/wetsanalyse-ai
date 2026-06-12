import pytest

from app.contracts import Feedback, JobState, StartRequest
from app.engine.orchestrator import WetsanalyseEngine
from app.wettenbank import WettenbankError

from conftest import FakeLLM, FakeWettenbank


def _start_req(review: bool) -> StartRequest:
    return StartRequest(bwbId="BWBR9999999", artikel="1", review=review)


async def test_autonoom_loopt_door_tot_klaar(engine, store):
    job = await engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)

    job = await store.load_job(job.id)
    assert job.state == JobState.klaar
    rapport = await store.lees_rapport(job.id)
    assert rapport is not None
    assert rapport["markeringen"][0]["klasse"] == "Rechtssubject"
    assert rapport["begrippen"][0]["naam"] == "belastingplichtige"
    assert len(job.provenance) == 2
    assert job.provenance[0].model == "fake-model"


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
        await engine.create_job(StartRequest(artikel="1"), "test")


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

    assert wb.calls == 2
    assert (await store.load_job(job.id)).state == JobState.klaar


async def test_create_job_retryt_bij_duplicate(engine, store, monkeypatch):
    """Een DuplicateKeyError (gelijktijdige identieke aanmaak) leidt tot een nieuwe poging."""
    from pymongo.errors import DuplicateKeyError

    echt_insert = store.insert_job
    pogingen = {"n": 0}

    async def flaky_insert(job):
        pogingen["n"] += 1
        if pogingen["n"] == 1:
            raise DuplicateKeyError("E11000 duplicate key")
        await echt_insert(job)

    monkeypatch.setattr(store, "insert_job", flaky_insert)
    job = await engine.create_job(_start_req(review=False), "test")
    assert pogingen["n"] == 2
    assert (await store.load_job(job.id)) is not None


async def test_create_job_uitputting_werpt_idconflict(engine, store, monkeypatch):
    from pymongo.errors import DuplicateKeyError

    from app.mongo_store import IdConflict

    async def altijd_duplicate(job):
        raise DuplicateKeyError("E11000 duplicate key")

    monkeypatch.setattr(store, "insert_job", altijd_duplicate)
    with pytest.raises(IdConflict):
        await engine.create_job(_start_req(review=False), "test")
