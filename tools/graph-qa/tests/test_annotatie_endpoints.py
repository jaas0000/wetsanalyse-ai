"""De nieuwe agent-ingang-endpoints (/v1/annoteer/intent, /v1/artikel) met gepatchte zware deps.

Bare TestClient (geen lifespan → geen startup-tokencheck); de LLM/graaf worden gemonkeypatcht zodat
er geen netwerk aan te pas komt. De inhoudelijke logica zit in test_annotatie_intent/test_artikel.
"""
from __future__ import annotations

import api.main as main
from fastapi.testclient import TestClient


def test_intent_endpoint(monkeypatch):
    monkeypatch.setattr("agent.adapters.anthropic_llm.AnthropicLLM", lambda _s: object())
    monkeypatch.setattr(
        "agent.annotatie_intent.parse_intent_sync",
        lambda prompt, catalogus, settings, llm: {
            "begrepen": {"bwbId": "BWBR0004770", "artikel": "9", "lid": "1", "wetnaam": "IW 1990"},
            "bevestiging": "Ik ga IW 1990 artikel 9 lid 1 annoteren.",
            "vraag": "",
        },
    )
    client = TestClient(main.app)
    r = client.post(
        "/v1/annoteer/intent",
        json={"prompt": "annoteer art 9 lid 1 IW", "catalogus": [{"bwbId": "BWBR0004770", "naam": "IW 1990"}]},
    )
    assert r.status_code == 200
    assert r.json()["begrepen"]["artikel"] == "9"


def test_artikel_endpoint(monkeypatch):
    class _Graph:
        def initialize(self):
            return {}

        def close(self):
            pass

    monkeypatch.setattr("agent.adapters.graphdb_graph.make_graph", lambda _s: _Graph())
    monkeypatch.setattr(
        "agent.artikel.haal_artikel_sync",
        lambda bwb, art, graph, lid=None: {
            "bwbId": bwb, "artikel": art, "citeertitel": "Invorderingswet 1990",
            "opschrift": "", "leden_teksten": [{"lid": "1", "tekst": "Eerste lid."}],
        },
    )
    client = TestClient(main.app)
    r = client.get("/v1/artikel", params={"bwb_id": "BWBR0004770", "artikel": "9"})
    assert r.status_code == 200
    body = r.json()
    assert body["citeertitel"] == "Invorderingswet 1990"
    assert body["leden_teksten"][0]["tekst"] == "Eerste lid."
