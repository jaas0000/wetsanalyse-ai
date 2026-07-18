"""chat-webhook endpoint: de kennisgraaf-agent achter de webapp-chatbel ({chatInput}→{output})."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import api.main as main
import pytest
from fastapi.testclient import TestClient

ART = "https://ipalm.nl/bwb/BWBR0004770/artikel/9"
_seen: dict = {}


async def _fake_answer_stream(question: str, conversation_id: str | None = None, **_kw) -> AsyncIterator[dict]:
    _seen["question"] = question
    _seen["conversation_id"] = conversation_id
    yield {"type": "token", "content": "Antwoord: "}
    yield {"type": "token", "content": question}
    yield {"type": "sources", "sources": [{"label": "art. 9 IW", "uri": ART}]}
    yield {"type": "grounding", "grounded": True, "unsupported": []}
    yield {"type": "done"}


def _client(monkeypatch, secret: str | None):
    monkeypatch.setattr(main, "answer_stream", _fake_answer_stream)
    monkeypatch.setattr(main.settings, "qa_api_token", secret)
    return TestClient(main.app)


def test_output_bevat_antwoord_en_bronnen(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/chat-webhook", json={"chatInput": "wat is art 9?", "sessionId": "sess-1"},
                    headers={"X-Chat-Secret": "geheim"})
    assert r.status_code == 200
    out = r.json()["output"]
    assert "Antwoord: wat is art 9?" in out
    assert "**Bronnen:**" in out and ART in out
    # sessionId → conversation_id (durabel geheugen).
    assert _seen["conversation_id"] == "sess-1"


def test_fout_secret_401(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/chat-webhook", json={"chatInput": "x"}, headers={"X-Chat-Secret": "fout"})
    assert r.status_code == 401


def test_ontbrekend_secret_401(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/chat-webhook", json={"chatInput": "x"})
    assert r.status_code == 401


def test_secret_in_body_wordt_geaccepteerd(monkeypatch):
    client = _client(monkeypatch, "geheim")
    r = client.post("/v1/chat-webhook", json={"chatInput": "x", "secret": "geheim"})
    assert r.status_code == 200


def test_geen_secret_geconfigureerd_is_open(monkeypatch):
    client = _client(monkeypatch, None)
    r = client.post("/v1/chat-webhook", json={"chatInput": "x"})
    assert r.status_code == 200


def test_logt_chat_webhook_metadata_avg_veilig(monkeypatch, caplog):
    client = _client(monkeypatch, "geheim")
    with caplog.at_level(logging.INFO, logger="graph_qa.chat"):
        r = client.post(
            "/v1/chat-webhook",
            json={"chatInput": "wat is art 9?", "sessionId": "sess-1"},
            headers={"X-Chat-Secret": "geheim"},
        )
    assert r.status_code == 200
    recs = [rec for rec in caplog.records if rec.name == "graph_qa.chat"]
    berichten = [rec.message for rec in recs]
    assert "chat-webhook ontvangen" in berichten
    assert "chat-webhook klaar" in berichten
    # start-regel draagt sessie-id + vraaglengte (metadata, geen inhoud).
    ontvangen = next(rec for rec in recs if rec.message == "chat-webhook ontvangen")
    assert ontvangen.chat_session_id == "sess-1"
    assert ontvangen.chat_vraag_lengte == len("wat is art 9?")
    # eind-regel draagt antwoordlengte + bron-aantal + grounded.
    klaar = next(rec for rec in recs if rec.message == "chat-webhook klaar")
    assert klaar.chat_antwoord_lengte > 0
    assert klaar.chat_bron_aantal == 1
    assert klaar.grounded is True
    # AVG: noch het secret noch de vraag-inhoud belandt in de logrecords.
    blob = " ".join(str(rec.__dict__) for rec in recs)
    assert "geheim" not in blob
    assert "wat is art 9?" not in blob


def test_startup_weigert_zonder_graphdb_token(monkeypatch):
    # `with TestClient` draait de lifespan-startup. Zonder GRAPHDB_TOKEN mag de service niet booten.
    monkeypatch.setattr(main.settings, "graphdb_token", None)
    with pytest.raises(ValueError, match="GRAPHDB_TOKEN"):
        with TestClient(main.app):
            pass


def test_startup_lukt_met_graphdb_token(monkeypatch):
    monkeypatch.setattr(main.settings, "graphdb_token", "tok-123")
    with TestClient(main.app):  # lifespan-startup slaagt → geen exception
        pass
