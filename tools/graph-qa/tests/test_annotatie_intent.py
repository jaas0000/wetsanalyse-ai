"""Intent-parse: begrijpen + catalogus-grounding (verzonnen bwbId afwijzen) + verduidelijkingsvraag."""
from __future__ import annotations

from agent.annotatie_intent import parse_intent_sync
from fakes import FakeLLM, make_settings, response, text_block

CAT = [{"bwbId": "BWBR0004770", "naam": "Invorderingswet 1990"}]


def _llm(json_text: str) -> FakeLLM:
    return FakeLLM([response([text_block(json_text)], "end_turn")])


def test_begrepen_bouwt_bevestiging():
    llm = _llm('{"bwbId":"BWBR0004770","artikel":"9","lid":"1","wetnaam":"Invorderingswet 1990","vraag":""}')
    r = parse_intent_sync("annoteer art 9 lid 1 IW", CAT, make_settings(), llm)
    assert r["begrepen"] == {"bwbId": "BWBR0004770", "artikel": "9", "lid": "1", "wetnaam": "Invorderingswet 1990"}
    assert "artikel 9 lid 1" in r["bevestiging"]
    assert r["vraag"] == ""


def test_verzonnen_bwbid_wordt_afgewezen():
    # Het model gokt een bwbId dat niet in de catalogus staat → geen begrip, wel een vraag.
    r = parse_intent_sync("...", CAT, make_settings(), _llm('{"bwbId":"BWBR9999999","artikel":"5","vraag":""}'))
    assert r["begrepen"] is None
    assert r["vraag"]


def test_model_vraag_blijft_behouden():
    r = parse_intent_sync("annoteer iets", CAT, make_settings(), _llm('{"bwbId":"","artikel":"","vraag":"Welke wet?"}'))
    assert r["begrepen"] is None
    assert r["vraag"] == "Welke wet?"
