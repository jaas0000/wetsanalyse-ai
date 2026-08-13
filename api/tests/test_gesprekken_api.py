"""Gesprekken-domein (api): chatgeschiedenis, berichten-append, per-gebruiker-scoping (X-User-Id)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

BASIS = "/v1/gesprekken"
# De BFF zet de ingelogde identiteit als vertrouwde X-User-Id-header; de tests doen dat expliciet.
A = {"X-User-Id": "gebruiker-a"}
B = {"X-User-Id": "gebruiker-b"}


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("WETSANALYSE_AUTH_REQUIRED", "0")

    from app import db, ratelimit
    from app.config import get_settings
    from app.deps import get_gesprek_store
    from app.gesprek_contracts import Gesprek
    from app.gesprek_store import GesprekStore
    from conftest import maak_testgebruikers

    get_settings.cache_clear()
    get_gesprek_store.cache_clear()
    ratelimit.reset()

    db.init_engine("sqlite+aiosqlite://")
    await db.create_all()
    await maak_testgebruikers("gebruiker-a", "gebruiker-b")

    # Gesprek van een andere gebruiker — moet voor gebruiker-a onzichtbaar zijn (404).
    await GesprekStore().maak_gesprek(Gesprek(id="andermans", user_id="gebruiker-b", titel="Van B"))

    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    get_settings.cache_clear()
    get_gesprek_store.cache_clear()
    await db.dispose_engine()


async def _maak(client, headers=A, titel="Vraag over invordering") -> str:
    r = await client.post(BASIS, json={"titel": titel}, headers=headers)
    assert r.status_code == 201
    return r.json()["id"]


async def test_gesprek_lifecycle_en_berichten(client):
    gid = await _maak(client)

    # verschijnt in de eigen lijst
    lijst = (await client.get(BASIS, headers=A)).json()
    assert any(g["id"] == gid for g in lijst)

    # user-bericht + assistent-bericht (met denk/bronnen) toevoegen
    r1 = await client.post(f"{BASIS}/{gid}/berichten", json={"rol": "user", "tekst": "Wat is uitstel?"}, headers=A)
    assert r1.status_code == 201
    r2 = await client.post(f"{BASIS}/{gid}/berichten", json={
        "rol": "assistant", "tekst": "Uitstel is …", "denk": "even nadenken",
        "bronnen": [{"titel": "art. 9"}],
    }, headers=A)
    assert r2.status_code == 201

    # volledig gesprek: berichten op volgorde, payload behouden
    doc = (await client.get(f"{BASIS}/{gid}", headers=A)).json()
    assert [b["rol"] for b in doc["berichten"]] == ["user", "assistant"]
    assert doc["berichten"][1]["denk"] == "even nadenken"
    assert doc["berichten"][1]["bronnen"][0]["titel"] == "art. 9"

    # samenvatting telt de berichten
    lijst = (await client.get(BASIS, headers=A)).json()
    assert next(g for g in lijst if g["id"] == gid)["aantal_berichten"] == 2

    # hernoemen
    doc = (await client.patch(f"{BASIS}/{gid}", json={"titel": "Uitstel van betaling"}, headers=A)).json()
    assert doc["titel"] == "Uitstel van betaling"


async def test_annotatie_bericht_verwijzing(client):
    gid = await _maak(client)
    r = await client.post(f"{BASIS}/{gid}/berichten", json={
        "rol": "assistant", "tekst": "Ik heb art. 9 geannoteerd.",
        "annotatie_slug": "doc-abc", "ontbrekend": [{"klasse": "Voorwaarde"}],
    }, headers=A)
    assert r.status_code == 201
    doc = (await client.get(f"{BASIS}/{gid}", headers=A)).json()
    assert doc["berichten"][0]["annotatie_slug"] == "doc-abc"
    assert doc["berichten"][0]["ontbrekend"][0]["klasse"] == "Voorwaarde"


async def test_user_scoping_404(client):
    # andermans gesprek → 404 op alle sub-resources (lekt niet)
    assert (await client.get(f"{BASIS}/andermans", headers=A)).status_code == 404
    assert (await client.post(f"{BASIS}/andermans/berichten", json={"rol": "user", "tekst": "x"}, headers=A)).status_code == 404
    assert (await client.patch(f"{BASIS}/andermans", json={"titel": "kaping"}, headers=A)).status_code == 404
    assert (await client.delete(f"{BASIS}/andermans", headers=A)).status_code == 404
    # en niet in de eigen lijst
    assert all(g["id"] != "andermans" for g in (await client.get(BASIS, headers=A)).json())
    # de eigenaar ziet 'm wel
    assert any(g["id"] == "andermans" for g in (await client.get(BASIS, headers=B)).json())


async def test_geen_gebruikerscontext_401(client):
    # zonder X-User-Id → 401 (geen gebruikerscontext), ook al is client-auth uit
    assert (await client.get(BASIS)).status_code == 401
    assert (await client.post(BASIS, json={"titel": "x"})).status_code == 401


async def test_verwijderen(client):
    gid = await _maak(client)
    await client.post(f"{BASIS}/{gid}/berichten", json={"rol": "user", "tekst": "hoi"}, headers=A)
    assert (await client.delete(f"{BASIS}/{gid}", headers=A)).status_code == 204
    assert (await client.get(f"{BASIS}/{gid}", headers=A)).status_code == 404


async def test_onbekende_gebruiker_401(client):
    """Een X-User-Id die geen account is, komt er niet in.

    De header is vertrouwd (de BFF zet 'm uit de sessie), maar de api had daar geen eigen slot op.
    Wie het client-token heeft, kon zo elke identiteit aannemen.
    """
    onbekend = {"X-User-Id": "bestaat-niet"}
    assert (await client.get(BASIS, headers=onbekend)).status_code == 401
    assert (await client.post(BASIS, json={"titel": "x"}, headers=onbekend)).status_code == 401


async def test_gedeactiveerde_gebruiker_verliest_toegang(client):
    """Deactiveren moet meteen bijten, niet pas als de sessie verloopt.

    Op gebruiker-b: die is analist. Gebruiker-a is de eerste beheerder en wordt beschermd door de
    invariant dat de laatste actieve beheerder niet gedeactiveerd kan worden.
    """
    from app import users
    from app.routers.auth import vergeet_actief

    gemaakt = await client.post(BASIS, json={"titel": "van b"}, headers=B)
    gid = gemaakt.json()["id"]
    assert (await client.get(f"{BASIS}/{gid}", headers=B)).status_code == 200

    await users.patch_user("gebruiker-b", active=False)
    vergeet_actief("gebruiker-b")  # in productie doet de admin-router dit

    assert (await client.get(f"{BASIS}/{gid}", headers=B)).status_code == 401
    assert (await client.get(BASIS, headers=B)).status_code == 401
