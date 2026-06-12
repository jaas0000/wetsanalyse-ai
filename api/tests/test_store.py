import pytest

from app.contracts import Feedback, Job, JobState
from app.project import Project


async def test_id_afleiding_en_collisie(store):
    assert await store.afgeleid_id("BWBR0004770", "9", "2") == "bwbr0004770-art9-lid2"
    await Project(slug="bwbr0004770-art9-lid2").insert()
    assert await store.afgeleid_id("BWBR0004770", "9", "2") == "bwbr0004770-art9-lid2-2"


async def test_job_roundtrip(store):
    job = Job(id="x-art1", bwbId="BWBR1", artikel="1", state=JobState.queued)
    await store.save_job(job)
    geladen = await store.load_job("x-art1")
    assert geladen.bwbId == "BWBR1"
    assert geladen.state == JobState.queued


async def test_analyse_immutabel(store):
    await store.save_job(Job(id="j", bwbId="X", artikel="1"))
    await store.schrijf_analyse("j", "2", 1, {"markeringen": [{"id": "m1"}]})
    with pytest.raises(PermissionError):
        await store.schrijf_analyse("j", "2", 1, {"markeringen": []})
    await store.schrijf_analyse("j", "2", 2, {"markeringen": []})
    assert await store.hoogste_ronde("j", "2") == 2


async def test_feedback_roundtrip(store):
    await store.save_job(Job(id="j2", bwbId="X", artikel="1"))
    fb = Feedback(status="wijzigingen", activiteit="2", items={"m1": "fout"}, algemeen="")
    await store.schrijf_feedback("j2", "2", 1, fb)
    result = await store.lees_feedback("j2", "2", 1)
    assert result.items == {"m1": "fout"}
