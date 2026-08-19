"""De run-endpoints over HTTP: een kijker die wegloopt doodt de beurt niet.

Dit is de eigenschap waar het hele run-model om draait, en de enige plek waar hij over de échte
HTTP-laag bewezen wordt (`tests/test_runs.py` doet hetzelfde op registerniveau).

Let op de `with TestClient(...)`: die houdt één portal — en dus één event loop — aan voor alle
requests, zoals uvicorn in productie. Zónder de `with` breekt de testharnas na elke request zijn loop
af, en dan sneuvelt de achtergrondtaak van de run; je meet dan de harnas, niet de code. De `with`
draait ook de lifespan, vandaar de token hieronder.
"""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

import api.main as main


def _nep_stroom(_request):
    """Vervangt de agent: we testen de run-machinerie, niet de LLM."""
    async def maak(_run):
        import asyncio

        for i in range(6):
            await asyncio.sleep(0.05)
            yield {"type": "token", "content": f"deel{i} "}
        yield {"type": "done"}
    return maak


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.settings, "graphdb_token", "test", raising=False)
    monkeypatch.setattr(main, "_stroom_voor", _nep_stroom)
    monkeypatch.setattr(main, "runs", type(main.runs)())
    with TestClient(main.app) as c:
        yield c


def _tokens(response) -> str:
    tekst = ""
    for regel in response.iter_lines():
        if regel.startswith("data:"):
            event = json.loads(regel[5:].strip())
            if event["type"] == "token":
                tekst += event["content"]
    return tekst


def test_run_loopt_door_nadat_de_kijker_weggaat(client):
    """De bug die dit oploste: van gesprek wisselen of herladen brak het antwoord af."""
    start = client.post("/v1/runs", json={"question": "annoteer artikel 9", "conversation_id": "g1"})
    assert start.status_code == 201
    run_id = start.json()["run_id"]

    # Kijk twee events mee en loop weg — precies wat een remount doet.
    with client.stream("GET", f"/v1/runs/{run_id}/events?vanaf=0") as stroom:
        gezien = 0
        for regel in stroom.iter_lines():
            if regel.startswith("data:"):
                gezien += 1
                if gezien == 2:
                    break

    time.sleep(0.6)
    actief = client.get("/v1/conversations/g1/run").json()
    assert actief["status"] == "klaar"
    assert actief["volgende_seq"] == 7  # alle events zijn geproduceerd, ook zonder kijker


def test_opnieuw_aanhaken_levert_precies_het_gemiste(client):
    run_id = client.post("/v1/runs", json={"question": "v", "conversation_id": "g1"}).json()["run_id"]
    time.sleep(0.6)
    with client.stream("GET", f"/v1/runs/{run_id}/events?vanaf=2") as stroom:
        assert _tokens(stroom) == "deel2 deel3 deel4 deel5 "


def test_tweede_run_op_hetzelfde_gesprek_verwijst_naar_de_lopende(client):
    """409 met het actieve run_id, zodat de client aanhaakt in plaats van een tweede beurt te
    starten — twee lussen op één thread_id schrijven door elkaar in het agent-geheugen."""
    eerste = client.post("/v1/runs", json={"question": "v", "conversation_id": "g1"}).json()
    tweede = client.post("/v1/runs", json={"question": "nog een", "conversation_id": "g1"})
    assert tweede.status_code == 409
    assert tweede.json()["detail"] == {"reden": "run_loopt_al", "run_id": eerste["run_id"]}


def test_onbekende_run_is_404(client):
    """Na een herstart is het register leeg. Dan hoort de client dát te horen, in plaats van eeuwig
    te wachten op een run die niet meer bestaat."""
    assert client.get("/v1/runs/bestaat-niet/events").status_code == 404
    assert client.post("/v1/runs/bestaat-niet/cancel").status_code == 404


def test_geen_actieve_run_geeft_null(client):
    assert client.get("/v1/conversations/leeg/run").json() is None


def test_stoppen_laat_de_run_netjes_eindigen(client, monkeypatch):
    """Stoppen loopt via een vlag die de stroom zelf leest — geen `task.cancel()`.

    Dat is het verschil met vroeger: de verbinding dichtgooien liet het werk doorlopen én gooide het
    resultaat weg. Nu stopt de beurt op een grens en blijft staan wat er al was."""
    gezien: list[bool] = []

    def stroom_die_kijkt(_request):
        async def maak(run):
            import asyncio

            for i in range(20):
                gezien.append(run.stop_gevraagd)
                if run.stop_gevraagd:
                    return
                await asyncio.sleep(0.05)
                yield {"type": "token", "content": f"deel{i} "}
        return maak

    monkeypatch.setattr(main, "_stroom_voor", stroom_die_kijkt)
    run_id = client.post("/v1/runs", json={"question": "v", "conversation_id": "g1"}).json()["run_id"]
    time.sleep(0.15)
    assert client.post(f"/v1/runs/{run_id}/cancel").status_code == 202

    time.sleep(0.3)
    stand = client.get("/v1/conversations/g1/run").json()
    assert stand["status"] == "gestopt"
    # Er is écht gestopt: de stroom zag de vlag en hield ermee op, ruim vóór de twintigste ronde.
    assert any(gezien) and len(gezien) < 20
    # En wat er al binnen was, staat er nog.
    assert stand["volgende_seq"] > 0


def test_gesprek_verwijderen_stopt_de_lopende_beurt(client):
    """Live gevonden op dev: het gesprek werd verwijderd terwijl de beurt liep, en de agent
    annoteerde daarna nog anderhalve minuut vrolijk door voor iets wat niet meer bestond."""
    run_id = client.post("/v1/runs", json={"question": "v", "conversation_id": "g1"}).json()["run_id"]
    assert client.delete("/v1/conversations/g1").status_code == 204

    time.sleep(0.4)
    stand = client.get(f"/v1/runs/{run_id}/events?vanaf=0")
    assert stand.status_code == 200
    assert client.get("/v1/conversations/g1/run").json()["status"] == "gestopt"


def test_verwijderen_van_een_gesprek_zonder_run_blijft_stil(client):
    """Idempotent: geen run, geen ophef."""
    assert client.delete("/v1/conversations/bestaat-niet").status_code == 204


def test_stoppen_is_een_verzoek(client):
    run_id = client.post("/v1/runs", json={"question": "v", "conversation_id": "g1"}).json()["run_id"]
    antwoord = client.post(f"/v1/runs/{run_id}/cancel")
    # 202, niet 204: de nodes zijn synchroon, dus de run eindigt pas op de eerstvolgende grens.
    assert antwoord.status_code == 202
    assert antwoord.json()["run_id"] == run_id
