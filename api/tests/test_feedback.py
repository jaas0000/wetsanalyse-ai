"""Tests voor de feedbackrouter: indienen en admin-leespad."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def client(monkeypatch):
    """ASGI-client met client- én admin-auth, in-memory SQLite, geen netwerk."""
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
    monkeypatch.setenv("WETSANALYSE_ADMIN_TOKENS", "adm:admin-token")
    monkeypatch.setenv("WETSANALYSE_AUTH_REQUIRED", "0")

    from app import db, ratelimit
    from app.config import get_settings
    from app.deps import get_store

    get_settings.cache_clear()
    get_store.cache_clear()
    ratelimit.reset()
    db.init_engine("sqlite+aiosqlite://")
    await db.create_all()

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    get_store.cache_clear()
    await db.dispose_engine()


_ADM = {"Authorization": "Bearer admin-token"}
_CLI = {}  # auth_required=0 → doorgelaten zonder token


async def test_feedback_indienen(client):
    """POST /v1/feedback geeft 201 + id terug."""
    res = await client.post(
        "/v1/feedback",
        json={"categorie": "verbeteridee", "tekst": "Knop werkt niet goed."},
        headers={**_CLI, "X-User-Id": "user1"},
    )
    assert res.status_code == 201
    data = res.json()
    assert "id" in data
    assert isinstance(data["id"], int)


async def test_feedback_met_pagina(client):
    """pagina-veld wordt opgeslagen."""
    res = await client.post(
        "/v1/feedback",
        json={"categorie": "compliment", "tekst": "Mooie interface!", "pagina": "/workbench"},
        headers={**_CLI, "X-User-Id": "user1"},
    )
    assert res.status_code == 201


async def test_feedback_ongeldige_categorie(client):
    """Ongeldige categorie → 422."""
    res = await client.post(
        "/v1/feedback",
        json={"categorie": "onbekend", "tekst": "Test."},
        headers={**_CLI, "X-User-Id": "user1"},
    )
    assert res.status_code == 422


async def test_feedback_lege_tekst(client):
    """Lege tekst → 422."""
    res = await client.post(
        "/v1/feedback",
        json={"categorie": "vraag", "tekst": ""},
        headers={**_CLI, "X-User-Id": "user1"},
    )
    assert res.status_code == 422


async def test_feedback_zonder_userid(client):
    """Ontbrekende X-User-Id → 401."""
    res = await client.post(
        "/v1/feedback",
        json={"categorie": "verbeteridee", "tekst": "Test."},
        headers=_CLI,
    )
    assert res.status_code == 401


async def test_admin_feedback_lijst(client):
    """GET /v1/admin/feedback geeft ingezonden items terug."""
    # Dien twee items in
    for tekst in ("Eerste bericht", "Tweede bericht"):
        await client.post(
            "/v1/feedback",
            json={"categorie": "probleemmelding", "tekst": tekst},
            headers={**_CLI, "X-User-Id": "user1"},
        )

    res = await client.get("/v1/admin/feedback", headers=_ADM)
    assert res.status_code == 200
    body = res.json()
    assert body["totaal"] == 2
    items = body["items"]
    assert len(items) == 2
    # Nieuwste eerst
    assert items[0]["tekst"] == "Tweede bericht"
    assert items[1]["tekst"] == "Eerste bericht"
    assert items[0]["categorie"] == "probleemmelding"
    assert "created" in items[0]


async def test_admin_feedback_zonder_token(client):
    """Admin-endpoint zonder admin-token → 401."""
    res = await client.get("/v1/admin/feedback")
    assert res.status_code == 401
