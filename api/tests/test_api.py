"""Fase 1 — read/serve over de jobstore, zonder engine/LLM. Auth uit voor de test."""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WETSANALYSE_AUTH_REQUIRED", "0")
    monkeypatch.setenv("WETSANALYSE_ANALYSES_DIR", str(tmp_path))
    from app.config import get_settings
    from app.deps import get_store

    get_settings.cache_clear()
    get_store.cache_clear()

    from app.contracts import Job, JobState
    from app.main import app

    store = get_store()
    store.save_job(Job(id="bwbr1-art1", state=JobState.queued, bwbId="BWBR1", artikel="1"))
    store.save_job(Job(id="klaar-art1", state=JobState.klaar, bwbId="BWBR2", artikel="1"))
    rapport = {"wet": "Testwet", "artikel": "1", "leden": [], "markeringen": [],
               "begrippen": [], "afleidingsregels": [], "reviewlog": {}, "aandachtspunten": ""}
    store.rapport_pad("klaar-art1").write_text(json.dumps(rapport), encoding="utf-8")

    with TestClient(app) as c:
        yield c

    get_settings.cache_clear()
    get_store.cache_clear()


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_ready_en_openapi(client):
    assert "llm_model_gezet" in client.get("/ready").json()
    assert client.get("/openapi.json").status_code == 200  # → importeerbaar in Postman


def test_lijst_en_status(client):
    ids = {j["id"] for j in client.get("/analyses").json()}
    assert {"bwbr1-art1", "klaar-art1"} <= ids
    assert client.get("/analyses/bwbr1-art1").json()["state"] == "queued"
    assert client.get("/analyses/bestaat-niet").status_code == 404


def test_rapport_serve(client):
    r = client.get("/analyses/klaar-art1/rapport")
    assert r.status_code == 200 and r.json()["wet"] == "Testwet"
    md = client.get("/analyses/klaar-art1/rapport.md")
    assert md.status_code == 200 and "# Wetsanalyse" in md.text


def test_feedback_buiten_review_409(client):
    r = client.post("/analyses/bwbr1-art1/feedback", json={"status": "akkoord", "activiteit": "2"})
    assert r.status_code == 409


def test_rapport_nog_niet_gereed_409(client):
    assert client.get("/analyses/bwbr1-art1/rapport").status_code == 409
