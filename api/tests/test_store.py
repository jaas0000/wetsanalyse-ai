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


async def test_save_job_overschrijft_geen_artefacten(store):
    """save_job mag uitsluitend state-velden raken — nooit eerder geschreven rondes/rapport."""
    await store.save_job(Job(id="j3", bwbId="X", artikel="1", state=JobState.queued))
    await store.schrijf_analyse("j3", "2", 1, {"markeringen": [{"id": "m1"}]})
    await store.schrijf_rapport("j3", {"wet": "Testwet"})

    # Een latere save_job (state-overgang) op een verse snapshot.
    job = await store.load_job("j3")
    job.state = JobState.wacht_review_act2
    await store.save_job(job)

    assert (await store.lees_analyse("j3", "2", 1)) == {"markeringen": [{"id": "m1"}]}
    assert (await store.lees_rapport("j3")) == {"wet": "Testwet"}
    assert (await store.load_job("j3")).state == JobState.wacht_review_act2


async def test_schrijfpaden_falen_netjes_zonder_project(store):
    """Schrijven naar een niet-bestaand project geeft KeyError, geen AttributeError."""
    fb = Feedback(status="wijzigingen", activiteit="2", items={}, algemeen="")
    with pytest.raises(KeyError):
        await store.schrijf_analyse("bestaat-niet", "2", 1, {})
    with pytest.raises(KeyError):
        await store.schrijf_feedback("bestaat-niet", "2", 1, fb)
