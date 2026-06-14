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
    from app import ratelimit
    get_settings.cache_clear()
    get_store.cache_clear()
    ratelimit.reset()  # globale rate-limit-staat niet laten lekken tussen tests

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
    await store.save_job(Job(id="review-art1", state=JobState.wacht_review_act2, bwbId="BWBR4", artikel="1", client_id="anonymous"))
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
    ids = {j["id"] for j in (await client.get("/v1/projects")).json()}
    assert {"bwbr1-art1", "klaar-art1"} <= ids
    assert (await client.get("/v1/projects/bwbr1-art1")).json()["state"] == "queued"
    assert (await client.get("/v1/projects/bestaat-niet")).status_code == 404


async def test_paginatie(client):
    """limit/offset begrenzen de lijst."""
    r = await client.get("/v1/projects", params={"limit": 1})
    assert r.status_code == 200 and len(r.json()) == 1


async def test_rapport_serve(client):
    r = await client.get("/v1/projects/klaar-art1/rapport")
    assert r.status_code == 200 and r.json()["wet"] == "Testwet"
    md = await client.get("/v1/projects/klaar-art1/rapport.md")
    assert md.status_code == 200 and "# Wetsanalyse" in md.text


async def test_feedback_buiten_review_409(client):
    r = await client.post("/v1/projects/bwbr1-art1/feedback", json={"status": "akkoord", "activiteit": "2"})
    assert r.status_code == 409


async def test_rapport_nog_niet_gereed_409(client):
    assert (await client.get("/v1/projects/bwbr1-art1/rapport")).status_code == 409


async def test_verwijderen_states(client):
    """Verwijderen mag vanuit een eindstaat én een review-pauze, niet vanuit een lopende state."""
    # queued (lopend) → 409
    assert (await client.delete("/v1/projects/bwbr1-art1")).status_code == 409
    # review-pauze → 204 (de analist gooit de analyse tijdens de review weg)
    assert (await client.delete("/v1/projects/review-art1")).status_code == 204
    assert (await client.get("/v1/projects/review-art1")).status_code == 404
    # eindstaat → 204
    assert (await client.delete("/v1/projects/klaar-art1")).status_code == 204


async def test_input_limiet_422(client):
    """Te lange vrije tekst wordt door Pydantic geweigerd (422), vóór de engine wordt geraakt."""
    r = await client.post(
        "/v1/projects", json={"artikel": "1", "bwbId": "BWBR1", "analysefocus": "x" * 3000}
    )
    assert r.status_code == 422


async def test_leeg_artikel_422(client):
    """Een leeg `artikel` wordt door Pydantic geweigerd (422), vóór MCP/LLM geraakt worden."""
    r = await client.post("/v1/projects", json={"artikel": "", "bwbId": "BWBR1"})
    assert r.status_code == 422
    # Ontbrekend artikel-veld blijft eveneens 422.
    assert (await client.post("/v1/projects", json={"bwbId": "BWBR1"})).status_code == 422


async def test_tenant_isolatie(client):
    """Een project van een andere client is onzichtbaar: 404 op alle by-id-routes en
    niet aanwezig in de lijst."""
    ids = {p["id"] for p in (await client.get("/v1/projects")).json()}
    assert "andermans-art1" not in ids
    assert {"bwbr1-art1", "klaar-art1"} <= ids

    # 404 (niet 403) op de by-id-routes — bestaan mag niet lekken.
    for path in (
        "/v1/projects/andermans-art1",
        "/v1/projects/andermans-art1/rapport",
        "/v1/projects/andermans-art1/ronde/2/1",
    ):
        assert (await client.get(path)).status_code == 404, path
    assert (await client.post("/v1/projects/andermans-art1/retry")).status_code == 404
    assert (await client.delete("/v1/projects/andermans-art1")).status_code == 404
