"""n8n-compat endpoint: drop-in vervanger van de n8n-chat-webhook ({chatInput}→{output})."""
from __future__ import annotations

from collections.abc import AsyncIterator

import api.main as main
from fastapi.testclient import TestClient

ART = "https://ipalm.nl/bwb/BWBR0004770/artikel/9"
_seen: dict = {}


async def _fake_answer_stream(question: str, conversation_id: str | None = None, **_kw) -> AsyncIterator[dict]:
    _seen["question"] = question
    _seen["conversation_id"] = conversation_id
    yield {"type": "token", "content": "Antwoord: "}
    yield {"type": "token", "content": question}
    yield {"type": "sources", "sources": [{"label": "art. 9 IW", "uri": ART}]}
    yield {"type": "done"}


def _client(monkeypatch, secret: str | None):
    monkeypatch.setattr(main, "answer_stream", _fake_answer_stream)
    monkeypatch.setattr(main.settings, "qa_api_token", secret)
    return TestClient(main.app)


def test_output_bevat_antwoord_en_bronnen(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/n8n-chat", json={"chatInput": "wat is art 9?", "sessionId": "sess-1"},
                    headers={"X-Chat-Secret": "geheim"})
    assert r.status_code == 200
    out = r.json()["output"]
    assert "Antwoord: wat is art 9?" in out
    assert "**Bronnen:**" in out and ART in out
    # sessionId → conversation_id (durabel geheugen).
    assert _seen["conversation_id"] == "sess-1"


def test_fout_secret_401(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/n8n-chat", json={"chatInput": "x"}, headers={"X-Chat-Secret": "fout"})
    assert r.status_code == 401


def test_ontbrekend_secret_401(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/n8n-chat", json={"chatInput": "x"})
    assert r.status_code == 401


def test_secret_in_body_wordt_geaccepteerd(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/n8n-chat", json={"chatInput": "x", "secret": "geheim"})
    assert r.status_code == 200


def test_geen_secret_geconfigureerd_is_open(monkeypatch):
    client = _client(monkeypatch, None)
    r = client.post("/v1/n8n-chat", json={"chatInput": "x"})
    assert r.status_code == 200
