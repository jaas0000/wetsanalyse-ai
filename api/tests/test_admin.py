"""Tests voor het LLM-beheer: crypto, profielen-resolutie/CRUD, admin-auth en token-verbruik."""

from __future__ import annotations

import mongomock_motor
import pytest
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient

from app.llm_profile import LlmProfile
from app.project import Project
from app.wet_catalog import WetCatalogus


def _fresh_settings(monkeypatch, **env):
    """Zet env, leeg de gecachte settings/crypto, en geef verse Settings terug."""
    from cryptography.fernet import Fernet

    from app import secrets_crypto
    from app.config import get_settings

    env.setdefault("LLM_CONFIG_SECRET", Fernet.generate_key().decode())
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    secrets_crypto._fernet.cache_clear()
    return get_settings()


@pytest.fixture
async def db():
    client = mongomock_motor.AsyncMongoMockClient()
    await init_beanie(database=client["test"], document_models=[Project, LlmProfile, WetCatalogus])
    return client


# --- crypto --------------------------------------------------------------------

def test_crypto_round_trip(monkeypatch):
    _fresh_settings(monkeypatch)
    from app import secrets_crypto

    assert secrets_crypto.crypto_beschikbaar()
    token = secrets_crypto.encrypt("geheime-key-123")
    assert token != "geheime-key-123"
    assert secrets_crypto.decrypt(token) == "geheime-key-123"


def test_crypto_zonder_master_key_faalt(monkeypatch):
    from app import secrets_crypto
    from app.config import get_settings

    monkeypatch.delenv("LLM_CONFIG_SECRET", raising=False)
    get_settings.cache_clear()
    secrets_crypto._fernet.cache_clear()
    assert not secrets_crypto.crypto_beschikbaar()
    with pytest.raises(secrets_crypto.SecretsCryptoError):
        secrets_crypto.encrypt("x")


# --- resolve_config ------------------------------------------------------------

async def test_resolve_config_valt_terug_op_env(monkeypatch, db):
    s = _fresh_settings(monkeypatch, LLM_MODEL="env-model", LLM_PROVIDER="azure_ai")
    from app import profiles

    # Geen profielen → env-fallback.
    cfg = await profiles.resolve_config(None, s)
    assert cfg.model == "env-model"
    assert cfg.provider == "azure_ai"


async def test_resolve_config_gebruikt_profiel_en_decrypt(monkeypatch, db):
    s = _fresh_settings(monkeypatch, LLM_MODEL="env-model")
    from app import profiles

    await profiles.upsert_profile(
        "snel", updated_by="t", provider="openai", model="gpt-x", api_key="sk-test"
    )
    cfg = await profiles.resolve_config("snel", s)
    assert cfg.model == "gpt-x"
    assert cfg.provider == "openai"
    assert cfg.api_key == "sk-test"  # ontsleuteld


async def test_eerste_profiel_is_default_en_seed_idempotent(monkeypatch, db):
    s = _fresh_settings(monkeypatch, LLM_MODEL="seed-model")
    from app import profiles

    await profiles.ensure_seeded(s)
    await profiles.ensure_seeded(s)  # idempotent
    alle = await profiles.list_profiles()
    assert len(alle) == 1
    assert alle[0].is_default and alle[0].model == "seed-model"


async def test_default_wisselen_en_niet_verwijderen(monkeypatch, db):
    _fresh_settings(monkeypatch)
    from app import profiles

    await profiles.upsert_profile("a", updated_by="t", model="m-a")  # wordt default
    await profiles.upsert_profile("b", updated_by="t", model="m-b")
    await profiles.set_default("b")
    assert (await profiles.get_profile("b")).is_default
    assert not (await profiles.get_profile("a")).is_default
    with pytest.raises(profiles.ProfileError):
        await profiles.delete_profile("b")  # default mag niet weg
    await profiles.delete_profile("a")  # niet-default mag wel


# --- usage ---------------------------------------------------------------------

async def test_usage_aggregatie(monkeypatch, db):
    _fresh_settings(monkeypatch)
    from app import usage

    def prov(model, ti, to):
        return {
            "activiteit": "2", "ronde": 1, "model": model, "provider": "p",
            "tokens_in": ti, "tokens_out": to, "tijdstip": "2026-06-01T00:00:00",
        }

    await Project(slug="p1", model_profile="snel", provenance=[prov("m1", 10, 5), prov("m1", 20, 10)]).insert()
    await Project(slug="p2", model_profile="snel", provenance=[prov("m2", 1, 1)]).insert()

    rapport = await usage.usage_report(group_by="model")
    per_model = {r["sleutel"]: r for r in rapport["rows"]}
    assert per_model["m1"]["tokens_in"] == 30
    assert per_model["m1"]["rondes"] == 2
    assert per_model["m1"]["analyses"] == 1
    assert rapport["totaal"]["tokens_in"] == 31
    assert rapport["totaal"]["tokens_out"] == 16

    per_profiel = await usage.usage_per_profiel()
    assert per_profiel["snel"]["tokens_in"] == 31


# --- admin-API -----------------------------------------------------------------

@pytest.fixture
async def admin_client(monkeypatch):
    _fresh_settings(monkeypatch, WETSANALYSE_ADMIN_TOKENS="adm:admin-token", WETSANALYSE_AUTH_REQUIRED="0")

    from app.deps import get_store
    from app import ratelimit
    get_store.cache_clear()
    ratelimit.reset()

    mock_mongo = mongomock_motor.AsyncMongoMockClient()
    await init_beanie(database=mock_mongo["test"], document_models=[Project, LlmProfile, WetCatalogus])

    import app.main as main_module
    monkeypatch.setattr(main_module, "AsyncIOMotorClient", lambda *a, **kw: mock_mongo)

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    get_store.cache_clear()


_H = {"Authorization": "Bearer admin-token"}


async def test_admin_auth_faalt_zonder_token(admin_client):
    assert (await admin_client.get("/v1/admin/profiles")).status_code == 401
    assert (await admin_client.get("/v1/admin/profiles", headers={"Authorization": "Bearer fout"})).status_code == 401


async def test_admin_crud_en_key_nooit_terug(admin_client):
    # Upsert met key.
    r = await admin_client.put(
        "/v1/admin/profiles/snel",
        headers=_H,
        json={"provider": "openai", "model": "gpt-x", "api_key": "sk-geheim"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["api_key_set"] is True
    assert body["is_default"] is True  # eerste profiel
    assert "api_key" not in body and "sk-geheim" not in r.text

    # Lijst toont het profiel, zonder key.
    lijst = (await admin_client.get("/v1/admin/profiles", headers=_H)).json()
    assert lijst[0]["name"] == "snel" and "sk-geheim" not in str(lijst)

    # Tweede profiel + default wisselen.
    await admin_client.put("/v1/admin/profiles/diep", headers=_H, json={"model": "o1"})
    r = await admin_client.post("/v1/admin/profiles/diep/default", headers=_H)
    assert r.json()["is_default"] is True

    # Default verwijderen → 409; niet-default → 204.
    assert (await admin_client.delete("/v1/admin/profiles/diep", headers=_H)).status_code == 409
    assert (await admin_client.delete("/v1/admin/profiles/snel", headers=_H)).status_code == 204


async def test_catalog_profiles_zonder_admin(admin_client):
    # /v1/profiles is niet-admin (geen admin-token) en geeft alleen naam + default.
    await admin_client.put("/v1/admin/profiles/snel", headers=_H, json={"model": "gpt-x"})
    r = await admin_client.get("/v1/profiles")
    assert r.status_code == 200
    rows = r.json()
    assert rows == [{"name": "snel", "is_default": True}]
    assert "gpt-x" not in r.text  # geen model/provider/key lekken


async def test_admin_usage_endpoint(admin_client):
    r = await admin_client.get("/v1/admin/usage", headers=_H)
    assert r.status_code == 200
    assert "totaal" in r.json() and "rows" in r.json()
    assert (await admin_client.get("/v1/admin/usage", headers=_H, params={"group_by": "fout"})).status_code == 400


# --- wet-catalogus -------------------------------------------------------------

async def test_wet_catalogus_crud(admin_client):
    # Upsert (admin) → terug in lijst.
    r = await admin_client.put("/v1/admin/wetten/BWBR0004770", headers=_H, json={"naam": "Successiewet 1956"})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "bwbId": "BWBR0004770", "naam": "Successiewet 1956",
        "updated_by": r.json()["updated_by"], "updated": r.json()["updated"],
    }
    lijst = (await admin_client.get("/v1/admin/wetten", headers=_H)).json()
    assert [w["bwbId"] for w in lijst] == ["BWBR0004770"]

    # Bijwerken (zelfde sleutel) en verwijderen.
    await admin_client.put("/v1/admin/wetten/BWBR0004770", headers=_H, json={"naam": "Successiewet"})
    assert (await admin_client.get("/v1/admin/wetten", headers=_H)).json()[0]["naam"] == "Successiewet"
    assert (await admin_client.delete("/v1/admin/wetten/BWBR0004770", headers=_H)).status_code == 204
    assert (await admin_client.delete("/v1/admin/wetten/BWBR0004770", headers=_H)).status_code == 404


async def test_wet_catalogus_admin_only(admin_client):
    # Beheer vereist het admin-token; de keuzelijst niet.
    assert (await admin_client.get("/v1/admin/wetten")).status_code == 401
    assert (await admin_client.put("/v1/admin/wetten/BWBR0004770", json={"naam": "x"})).status_code == 401


async def test_catalog_wetten_zonder_admin(admin_client):
    await admin_client.put("/v1/admin/wetten/BWBR0004770", headers=_H, json={"naam": "Successiewet 1956"})
    r = await admin_client.get("/v1/wetten")
    assert r.status_code == 200
    assert r.json() == [{"bwbId": "BWBR0004770", "naam": "Successiewet 1956"}]


async def test_wet_resolve_via_mcp(admin_client, monkeypatch):
    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def structuur(self, bwb_id):
            return {"bwbId": bwb_id, "citeertitel": "Successiewet 1956"}

    monkeypatch.setattr("app.wetten.WettenbankClient", FakeClient)
    r = await admin_client.post("/v1/admin/wetten/BWBR0004770/resolve", headers=_H)
    assert r.status_code == 200, r.text
    assert r.json() == {"naam": "Successiewet 1956"}


async def test_wet_resolve_mcp_fout_geeft_502(admin_client, monkeypatch):
    from app.wettenbank import WettenbankError

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def structuur(self, bwb_id):
            raise WettenbankError("MCP onbereikbaar")

    monkeypatch.setattr("app.wetten.WettenbankClient", FakeClient)
    r = await admin_client.post("/v1/admin/wetten/BWBR0004770/resolve", headers=_H)
    assert r.status_code == 502
