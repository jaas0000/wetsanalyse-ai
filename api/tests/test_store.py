import pytest

from app.contracts import Feedback, Job, JobState


def test_id_afleiding_en_collisie(store):
    assert store.afgeleid_id("BWBR0004770", "9", "2") == "bwbr0004770-art9-lid2"
    (store.root / "bwbr0004770-art9-lid2").mkdir(parents=True)
    assert store.afgeleid_id("BWBR0004770", "9", "2") == "bwbr0004770-art9-lid2-2"


def test_job_roundtrip(store):
    job = Job(id="x-art1", bwbId="BWBR1", artikel="1", state=JobState.queued)
    store.save_job(job)
    geladen = store.load_job("x-art1")
    assert geladen.bwbId == "BWBR1"
    assert geladen.state == JobState.queued


def test_analyse_immutabel(store):
    store.schrijf_analyse("j", "2", 1, {"markeringen": [{"id": "m1"}]})
    with pytest.raises(PermissionError):
        store.schrijf_analyse("j", "2", 1, {"markeringen": []})
    # nieuwe ronde mag wel
    store.schrijf_analyse("j", "2", 2, {"markeringen": []})
    assert store.hoogste_ronde("j", "2") == 2


def test_feedback_roundtrip(store):
    fb = Feedback(status="wijzigingen", activiteit="2", items={"m1": "fout"}, algemeen="")
    store.schrijf_feedback("j", "2", 1, fb)
    assert store.lees_feedback("j", "2", 1).items == {"m1": "fout"}
