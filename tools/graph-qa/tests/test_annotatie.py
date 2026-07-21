"""Annotatie-flow: brongetrouwheid (fragment = letterlijk substring), klasse-validatie, span."""
from __future__ import annotations

import asyncio
import json

from agent.annotatie import annoteer_stream
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block

CORPUS = "1. De ontvanger kan uitstel van betaling verlenen aan de belastingschuldige."


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def _llm_met(elementen):
    payload = json.dumps({"elementen": elementen}, ensure_ascii=False)
    return FakeLLM([response([text_block(payload)], "end_turn")])


def test_grounded_elementen_en_verwerpt_hallucinatie_en_ongeldige_klasse():
    llm = _llm_met([
        {"klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1", "toelichting": "wie handelt", "alternatieven": []},
        {"klasse": "Rechtsbetrekking", "tekst": "kan uitstel van betaling verlenen", "lid": "1",
         "toelichting": "bevoegdheid", "alternatieven": [{"klasse": "NietBestaand", "motivatie": "x"}]},
        {"klasse": "Rechtssubject", "tekst": "dit staat niet in de tekst", "lid": "1", "toelichting": "x", "alternatieven": []},
        {"klasse": "OngeldigeKlasse", "tekst": "De ontvanger", "lid": "1", "toelichting": "x", "alternatieven": []},
    ])
    graph = FakeGraph(result=CORPUS)
    events = _run(annoteer_stream("BWBR0004770", "9", settings=make_settings(), llm=llm, graph=graph))

    elementen = [e["element"] for e in events if e["type"] == "element"]
    done = next(e for e in events if e["type"] == "done")

    # 2 grounded + geldig; 2 verworpen (hallucinatie + ongeldige klasse)
    assert len(elementen) == 2
    assert done["aantal"] == 2 and done["verworpen"] == 2
    assert {el["klasse"] for el in elementen} == {"Rechtssubject", "Rechtsbetrekking"}

    for el in elementen:
        assert el["grounded"] is True
        assert el["span"] and el["span"][0] >= 0 and el["span"][1] > el["span"][0]
        assert el["vindplaats"].startswith("BWBR0004770 art. 9")

    # ongeldige alternatief-klasse is uitgefilterd
    rb = next(el for el in elementen if el["klasse"] == "Rechtsbetrekking")
    assert rb["alternatieven"] == []
    assert graph.closed


def test_leeg_artikel_geeft_error():
    graph = FakeGraph(result="")
    events = _run(annoteer_stream("BWBR0004770", "999", settings=make_settings(), llm=_llm_met([]), graph=graph))
    assert any(e["type"] == "error" for e in events)


def test_onparsebare_json_levert_geen_elementen():
    llm = FakeLLM([response([text_block("dit is geen JSON")], "end_turn")])
    graph = FakeGraph(result=CORPUS)
    events = _run(annoteer_stream("BWBR0004770", "9", settings=make_settings(), llm=llm, graph=graph))
    assert not any(e["type"] == "element" for e in events)
    assert next(e for e in events if e["type"] == "done")["aantal"] == 0
