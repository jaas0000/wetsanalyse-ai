from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from app import db
from app.contracts import Feedback, Job, JobState


async def _set_lease(slug: str, owner: str | None, lease_until) -> None:
    """Test-helper: zet owner/lease_until direct (claim zet altijd een verse, toekomstige lease)."""
    async with db.get_engine().begin() as conn:
        await conn.execute(
            update(db.projects).where(db.projects.c.slug == slug)
            .values(owner=owner, lease_until=lease_until)
        )


async def test_id_afleiding_en_collisie(store):
    assert await store.afgeleid_id("BWBR0004770", "9", "2") == "bwbr0004770-art9-lid2"
    await store.save_job(Job(id="bwbr0004770-art9-lid2", bwbId="BWBR0004770", artikel="9", lid="2"))
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


async def test_postgresstore_voldoet_aan_jobstore(store):
    from app.jobstore import JobStore
    assert isinstance(store, JobStore)


def test_rate_limiter_sliding_window():
    from app import ratelimit

    ratelimit.reset()
    assert all(ratelimit._allow("k", 3, 60) for _ in range(3))
    assert not ratelimit._allow("k", 3, 60)   # 4e in venster geweigerd
    assert ratelimit._allow("andere-key", 3, 60)  # per client gescheiden


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


# --- concurrency: state-CAS (claim/lease) ---

async def test_claim_eenmalig(store):
    """De eerste claim wint; een tweede claim ziet de al-gewijzigde state → None (geen dubbele pickup)."""
    await store.save_job(Job(id="c1", bwbId="X", artikel="1", state=JobState.queued))
    eerste = await store.claim("c1", {JobState.queued}, JobState.act2_runt, "worker-a", 120)
    assert eerste is not None and eerste.state == JobState.act2_runt
    tweede = await store.claim("c1", {JobState.queued}, JobState.act2_runt, "worker-b", 120)
    assert tweede is None
    # De job is nu eigendom van worker-a met een verse lease.
    p = await store.load_project("c1")
    assert p.owner == "worker-a" and p.lease_until is not None


async def test_claim_alleen_verlopen_lease(store):
    """vereist_verlopen_lease=True claimt een verse lease NIET, een verlopen lease wel (reaper)."""
    await store.save_job(Job(id="c2", bwbId="X", artikel="1", state=JobState.act2_runt))
    await _set_lease("c2", "worker-a", datetime.now(timezone.utc) + timedelta(seconds=120))
    # Verse lease → reaper-claim mist.
    assert await store.claim("c2", {JobState.act2_runt}, JobState.fout, "reaper", 120,
                             vereist_verlopen_lease=True) is None
    # Lease in het verleden → reaper-claim slaagt.
    await _set_lease("c2", "worker-a", datetime.now(timezone.utc) - timedelta(seconds=1))
    geclaimd = await store.claim("c2", {JobState.act2_runt}, JobState.fout, "reaper", 120,
                                 vereist_verlopen_lease=True)
    assert geclaimd is not None and geclaimd.state == JobState.fout


async def test_verleng_lease_alleen_door_owner(store):
    """De heartbeat verlengt de lease alleen voor de huidige owner in een runt-state (fencing)."""
    await store.save_job(Job(id="c3", bwbId="X", artikel="1", state=JobState.queued))
    await store.claim("c3", {JobState.queued}, JobState.act2_runt, "worker-a", 120)
    assert await store.verleng_lease("c3", "worker-a", 120) is True
    assert await store.verleng_lease("c3", "worker-b", 120) is False  # niet de owner


async def test_lijst_verlopen_running(store):
    """Alleen runt-jobs met een verlopen lease komen in de reaper-lijst."""
    verleden = datetime.now(timezone.utc) - timedelta(seconds=1)
    toekomst = datetime.now(timezone.utc) + timedelta(seconds=120)
    await store.save_job(Job(id="r-verlopen", bwbId="X", artikel="1", state=JobState.act2_runt))
    await _set_lease("r-verlopen", "w", verleden)
    await store.save_job(Job(id="r-vers", bwbId="X", artikel="1", state=JobState.act3_runt))
    await _set_lease("r-vers", "w", toekomst)
    await store.save_job(Job(id="r-review", bwbId="X", artikel="1", state=JobState.wacht_review_act2))
    await _set_lease("r-review", "w", verleden)
    ids = await store.lijst_verlopen_running()
    assert ids == ["r-verlopen"]


async def test_claim_overschrijft_geen_owner_via_save_job(store):
    """save_job mag owner/lease_until NIET schrijven — die horen alleen bij claim/verleng_lease."""
    await store.save_job(Job(id="c4", bwbId="X", artikel="1", state=JobState.queued))
    await store.claim("c4", {JobState.queued}, JobState.act2_runt, "worker-a", 120)
    voor = await store.load_project("c4")
    # Een latere state-overgang via een verse Job-snapshot (zonder owner-kennis).
    job = await store.load_job("c4")
    job.state = JobState.wacht_review_act2
    await store.save_job(job)
    na = await store.load_project("c4")
    assert na.owner == "worker-a"
    assert na.lease_until == voor.lease_until


async def test_set_current_fase_fenced_zonder_updated_bump(store):
    """De observerende fase-tik is owner-fenced en raakt `updated` (de homepage-sortering) niet."""
    await store.save_job(Job(id="f1", bwbId="X", artikel="1", state=JobState.queued))
    await store.claim("f1", {JobState.queued}, JobState.act2_runt, "worker-a", 120)
    updated_voor = (await store.load_project("f1")).updated

    assert await store.set_current_fase("f1", "llm-generatie", "worker-a") is True
    p = await store.load_project("f1")
    assert p.current_fase == "llm-generatie"
    assert p.current_fase_sinds is not None
    assert p.updated == updated_voor  # géén updated-bump

    # Verkeerde/verloren owner → geen match, geen clobber.
    assert await store.set_current_fase("f1", "schema-check", "worker-b") is False
    assert (await store.load_project("f1")).current_fase == "llm-generatie"

    # Wissen (None) bij overgang naar review/terminal.
    assert await store.set_current_fase("f1", None, "worker-a") is True
    p = await store.load_project("f1")
    assert p.current_fase is None and p.current_fase_sinds is None
