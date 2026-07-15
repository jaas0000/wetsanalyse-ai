"""Tests voor de kennisgraaf-chatbot: admin-settings-roundtrip (secret gemaskeerd) en /v1/chat
(webhook gemockt, aan/uit-gedrag). Geen netwerk."""

from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _leeg_cache():
    from app import app_settings

    app_settings._wis_cache()
    yield
    app_settings._wis_cache()


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("WETSANALYSE_ADMIN_TOKENS", "adm:admin-token")
    monkeypatch.setenv("WETSANALYSE_AUTH_REQUIRED", "0")
    monkeypatch.setenv("LLM_CONFIG_SECRET", Fernet.generate_key().decode())

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


_ADMIN = {"Authorization": "Bearer admin-token"}


def _sse_answer(resp) -> str:
    """Haal het antwoord uit de SSE-respons van /v1/chat (data:-frame)."""
    for line in resp.text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:"):].strip()).get("answer", "")
    return ""


class _FakeResp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    @property
    def text(self):
        return json.dumps(self._data)


class _FakeClient:
    """Vervangt httpx.AsyncClient in de chat-router; onthoudt de laatste POST."""

    last: dict | None = None

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _FakeClient.last = {"url": url, "json": json, "headers": headers}
        return _FakeResp({"output": "De Invorderingswet 1990 valt onder Financiën."})


async def test_settings_roundtrip_secret_gemaskeerd(client):
    # Standaard staat de chat uit en is er geen secret.
    r = (await client.get("/v1/admin/settings", headers=_ADMIN)).json()
    assert r["chat_enabled"] is False and r["chat_secret_set"] is False

    await client.put(
        "/v1/admin/settings",
        headers=_ADMIN,
        json={"chat_enabled": True, "chat_webhook_url": "https://n8n/x/chat", "chat_secret": "geheim"},
    )
    r = (await client.get("/v1/admin/settings", headers=_ADMIN)).json()
    assert r["chat_enabled"] is True
    assert r["chat_webhook_url"] == "https://n8n/x/chat"
    assert r["chat_secret_set"] is True
    assert "chat_secret" not in r  # het secret verlaat de server nooit

    # Een lege secret-input laat het bestaande secret staan (geen per ongeluk wissen).
    await client.put("/v1/admin/settings", headers=_ADMIN, json={"chat_secret": ""})
    assert (await client.get("/v1/admin/settings", headers=_ADMIN)).json()["chat_secret_set"] is True


async def test_chat_uit_geeft_403(client):
    assert (await client.post("/v1/chat", json={"chatInput": "hoi"})).status_code == 403
    # config-endpoint bevestigt: uit.
    assert (await client.get("/v1/chat/config")).json()["enabled"] is False


async def test_chat_aan_proxyt_naar_webhook(client, monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router.httpx, "AsyncClient", _FakeClient)
    await client.put(
        "/v1/admin/settings",
        headers=_ADMIN,
        json={"chat_enabled": True, "chat_webhook_url": "https://n8n/x/chat", "chat_secret": "s3"},
    )
    assert (await client.get("/v1/chat/config")).json()["enabled"] is True

    r = await client.post("/v1/chat", json={"chatInput": "Wie is verantwoordelijk?", "sessionId": "sess-1"})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")
    assert "Financiën" in _sse_answer(r)
    # De router stuurde de n8n-chat-body (incl. het secret als body-veld) + de header door.
    assert _FakeClient.last["json"] == {
        "action": "sendMessage",
        "sessionId": "sess-1",
        "chatInput": "Wie is verantwoordelijk?",
        "secret": "s3",
    }
    assert _FakeClient.last["headers"]["X-Chat-Secret"] == "s3"


async def test_chat_lege_vraag_400(client, monkeypatch):
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router.httpx, "AsyncClient", _FakeClient)
    await client.put(
        "/v1/admin/settings",
        headers=_ADMIN,
        json={"chat_enabled": True, "chat_webhook_url": "https://n8n/x/chat"},
    )
    assert (await client.post("/v1/chat", json={"chatInput": "   "})).status_code == 400


async def test_chat_rate_limit_per_gebruiker(client, monkeypatch):
    from app import ratelimit
    from app.config import get_settings
    from app.routers import chat as chat_router

    monkeypatch.setattr(chat_router.httpx, "AsyncClient", _FakeClient)
    monkeypatch.setenv("WETSANALYSE_CHAT_RATE_MAX", "2")
    monkeypatch.setenv("WETSANALYSE_CHAT_RATE_WINDOW", "60")
    get_settings.cache_clear()
    ratelimit.reset()
    await client.put(
        "/v1/admin/settings",
        headers=_ADMIN,
        json={"chat_enabled": True, "chat_webhook_url": "https://n8n/x/chat"},
    )
    alice = {"X-User-Id": "alice"}
    assert (await client.post("/v1/chat", json={"chatInput": "1"}, headers=alice)).status_code == 200
    assert (await client.post("/v1/chat", json={"chatInput": "2"}, headers=alice)).status_code == 200
    # Derde binnen het venster → 429; het is een eigen bucket per gebruiker.
    assert (await client.post("/v1/chat", json={"chatInput": "3"}, headers=alice)).status_code == 429
    # Andere gebruiker heeft z'n eigen budget.
    assert (
        await client.post("/v1/chat", json={"chatInput": "1"}, headers={"X-User-Id": "bob"})
    ).status_code == 200
