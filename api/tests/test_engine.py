import pytest

from app.contracts import Feedback, JobState, StartRequest
from app.engine.orchestrator import WetsanalyseEngine
from app.wettenbank import WettenbankError

from conftest import FakeLLM, FakeWettenbank


def _start_req(review: bool) -> StartRequest:
    return StartRequest(bwbId="BWBR9999999", artikel="1", review=review)


async def test_autonoom_loopt_door_tot_klaar(engine, store):
    job = engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)

    job = store.load_job(job.id)
    assert job.state == JobState.klaar
    rapport_pad = store.rapport_pad(job.id)
    assert rapport_pad.exists()
    import json
    rapport = json.loads(rapport_pad.read_text())
    assert rapport["markeringen"][0]["klasse"] == "Rechtssubject"
    assert rapport["begrippen"][0]["naam"] == "belastingplichtige"
    # provenance per ronde vastgelegd (audit)
    assert len(job.provenance) == 2
    assert job.provenance[0].model == "fake-model"


async def test_review_pauzeert_en_akkoord_vordert(engine, store):
    job = engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)
    assert store.load_job(job.id).state == JobState.wacht_review_act2

    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="2"))
    assert store.load_job(job.id).state == JobState.wacht_review_act3

    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="3"))
    assert store.load_job(job.id).state == JobState.klaar


async def test_wijzigingen_maakt_nieuwe_ronde(engine, store):
    job = engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)

    await engine.apply_feedback(
        job.id, Feedback(status="wijzigingen", activiteit="2", items={"m1": "herzie de klasse"})
    )
    job = store.load_job(job.id)
    assert job.state == JobState.wacht_review_act2
    assert job.current_ronde == 2
    assert store.hoogste_ronde(job.id, "2") == 2


async def test_feedback_buiten_review_doet_niets(engine, store):
    job = engine.create_job(_start_req(review=True), "test")
    # state is queued; apply_feedback mag niets doen
    await engine.apply_feedback(job.id, Feedback(status="akkoord", activiteit="2"))
    assert store.load_job(job.id).state == JobState.queued


async def test_hallucinatie_faalt_hard(settings, store):
    eng = WetsanalyseEngine(settings, store, FakeLLM(hallucineer=True), FakeWettenbank())
    job = eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    job = store.load_job(job.id)
    assert job.state == JobState.fout
    assert job.error.klasse.value == "validatie"
    assert "Brongetrouwheid" in job.error.bericht


async def test_mcp_fout_faalt(settings, store):
    eng = WetsanalyseEngine(
        settings, store, FakeLLM(), FakeWettenbank(fout=WettenbankError("MCP down"))
    )
    job = eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)

    job = store.load_job(job.id)
    assert job.state == JobState.fout
    assert job.error.klasse.value == "mcp"


async def test_retry_vanuit_fout(settings, store):
    eng = WetsanalyseEngine(
        settings, store, FakeLLM(), FakeWettenbank(fout=WettenbankError("MCP down"))
    )
    job = eng.create_job(_start_req(review=False), "test")
    await eng.run_initial(job.id)
    assert store.load_job(job.id).state == JobState.fout

    # MCP weer ok → retry vanaf het begin (geen ronde geschreven)
    eng.wb = FakeWettenbank()
    await eng.retry(job.id)
    assert store.load_job(job.id).state == JobState.klaar


def test_bwbid_verplicht(engine):
    with pytest.raises(ValueError):
        engine.create_job(StartRequest(artikel="1"), "test")
