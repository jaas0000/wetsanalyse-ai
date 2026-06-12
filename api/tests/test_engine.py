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
