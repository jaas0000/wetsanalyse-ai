"""API-integratie-tests — geen engine/LLM, wel MongoDB (mongomock-motor)."""

from __future__ import annotations

import mongomock_motor
import pytest
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient

from app.contracts import Job, JobState
from app.mongo_store import MongoStore
from app.project import Project


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("WETSANALYSE_AUTH_REQUIRED", "0")

    from app.config import get_settings
    from app.deps import get_store
    get_settings.cache_clear()
    get_store.cache_clear()

    mock_mongo = mongomock_motor.AsyncMongoMockClient()
    await init_beanie(database=mock_mongo["test"], document_models=[Project])

    settings = get_settings()
    store = MongoStore(settings)

    rapport = {
        "wet": "Testwet", "artikel": "1", "leden": [], "markeringen": [],
        "begrippen": [], "afleidingsregels": [], "reviewlog": {}, "aandachtspunten": "",
    }
    # Onder AUTH_REQUIRED=0 is de geauthenticeerde client_id "anonymous"; de testdata is
    # van diezelfde eigenaar zodat de ownership-check (IDOR) de happy path niet blokkeert.
    await store.save_job(Job(id="bwbr1-art1", state=JobState.queued, bwbId="BWBR1", artikel="1", client_id="anonymous"))
    await store.save_job(Job(id="klaar-art1", state=JobState.klaar, bwbId="BWBR2", artikel="1", client_id="anonymous"))
    await store.schrijf_rapport("klaar-art1", rapport)
    # Project van een andere tenant — mag voor "anonymous" onzichtbaar zijn (404 + niet in lijst).
    await store.save_job(Job(id="andermans-art1", state=JobState.klaar, bwbId="BWBR3", artikel="1", client_id="andere-client"))
    await store.schrijf_rapport("andermans-art1", rapport)

    # Patch de lifespan zodat hij geen echte MongoDB-verbinding probeert op te zetten.
    import app.main as main_module
    monkeypatch.setattr(main_module, "AsyncIOMotorClient", lambda *a, **kw: mock_mongo)

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    get_settings.cache_clear()
    get_store.cache_clear()


async def test_health(client):
    assert (await client.get("/health")).json()["status"] == "ok"


async def test_ready_en_openapi(client):
    assert "llm_model_gezet" in (await client.get("/ready")).json()
    assert (await client.get("/openapi.json")).status_code == 200


async def test_lijst_en_status(client):
    ids = {j["id"] for j in (await client.get("/analyses")).json()}
    assert {"bwbr1-art1", "klaar-art1"} <= ids
    assert (await client.get("/analyses/bwbr1-art1")).json()["state"] == "queued"
    assert (await client.get("/analyses/bestaat-niet")).status_code == 404


async def test_rapport_serve(client):
    r = await client.get("/analyses/klaar-art1/rapport")
    assert r.status_code == 200 and r.json()["wet"] == "Testwet"
    md = await client.get("/analyses/klaar-art1/rapport.md")
    assert md.status_code == 200 and "# Wetsanalyse" in md.text


async def test_feedback_buiten_review_409(client):
    r = await client.post("/analyses/bwbr1-art1/feedback", json={"status": "akkoord", "activiteit": "2"})
    assert r.status_code == 409


async def test_rapport_nog_niet_gereed_409(client):
    assert (await client.get("/analyses/bwbr1-art1/rapport")).status_code == 409


async def test_tenant_isolatie(client):
    """Een project van een andere client is onzichtbaar: 404 op alle by-id-routes en
    niet aanwezig in de lijst-endpoints."""
    # Niet in de lijsten.
    analyse_ids = {j["id"] for j in (await client.get("/analyses")).json()}
    project_ids = {p["id"] for p in (await client.get("/projects")).json()}
    assert "andermans-art1" not in analyse_ids
    assert "andermans-art1" not in project_ids
    assert {"bwbr1-art1", "klaar-art1"} <= analyse_ids

    # 404 (niet 403) op de by-id-routes — bestaan mag niet lekken.
    for path in (
        "/analyses/andermans-art1",
        "/analyses/andermans-art1/rapport",
        "/analyses/andermans-art1/act/2/ronde/1",
        "/projects/andermans-art1",
        "/projects/andermans-art1/rapport",
        "/projects/andermans-art1/ronde/2/1",
    ):
        assert (await client.get(path)).status_code == 404, path
    assert (await client.post("/analyses/andermans-art1/retry")).status_code == 404
    assert (await client.delete("/projects/andermans-art1")).status_code == 404
