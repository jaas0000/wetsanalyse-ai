"""De annotatie-flow in de supervisor-graaf: supervisor → OPHAAL-agent (retrieval) → aparte
ANNOTEER-stap. Draait de échte LangGraph (prod-config: decompositie aan) met FakeLLM/FakeGraph.

FakeLLM-volgorde per annotatie: supervisor(create) → ophaal-agent turn1(stream, tool_use) →
ophaal-agent turn2(stream, doel-JSON) → annoteer-stap(create, elementen-JSON).
"""
from __future__ import annotations

import asyncio
import json

from agent.agent import answer_stream
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block, tool_block

# get_lid/get_bepaling leveren SPARQL-TSV met ?tekst; JSON-string-encoded zoals de MCP.
LID_TSV = json.dumps('?nummer\t?tekst\t?jci\n"1"\t"De ontvanger verleent uitstel van betaling."@nl\t"jci"')

ELEMENTEN_JSON = json.dumps({
    "elementen": [
        {"klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1", "toelichting": "wie", "alternatieven": []},
        {"klasse": "Rechtsbetrekking", "tekst": "verleent uitstel van betaling", "lid": "1", "toelichting": "wat", "alternatieven": []},
    ],
})


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def test_ophalen_dan_annoteren_grondt_lid():
    llm = FakeLLM([
        response([text_block("WORKERS: annotatie\nPLAN: annoteer art 9 lid 1")], "end_turn"),        # supervisor
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block('{"bwbId":"BWBR0004770","artikel":"9","lid":"1","nummer":"","citeertitel":"IW 1990"}')], "end_turn"),
        response([text_block(ELEMENTEN_JSON)], "end_turn"),                                           # annoteer-stap
    ])
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True), llm=llm, graph=FakeGraph(result=LID_TSV),
    ))

    doel = next(e for e in events if e["type"] == "doel")["doel"]
    assert doel["bwbId"] == "BWBR0004770" and doel["artikel"] == "9" and doel["lid"] == "1"
    assert doel["leden_teksten"][0]["tekst"].startswith("De ontvanger")  # opgehaalde tekst meegestuurd

    elementen = [e["element"] for e in events if e["type"] == "element"]
    assert {el["klasse"] for el in elementen} == {"Rechtssubject", "Rechtsbetrekking"}
    for el in elementen:
        assert el["grounded"] is True
        assert el["vindplaats"] == "BWBR0004770 art. 9 lid 1"


def test_get_bepaling_route_voor_decimaal_nummer():
    # Beleidsregel/divisie: de ophaal-agent gebruikt get_bepaling('9.1'); doel.nummer/artikel = '9.1'.
    bep_tsv = json.dumps('?nummer\t?tekst\t?label\n"9.1"\t"In de gevallen waarin voor voorlopige aanslagen."@nl\t"Afwijking"')
    llm = FakeLLM([
        response([text_block("WORKERS: annotatie\nPLAN: annoteer 9.1")], "end_turn"),                 # supervisor
        response([tool_block("t1", "get_bepaling", {"bwb_id": "BWBR0024096", "nummer": "9.1"})], "tool_use"),
        response([text_block('{"bwbId":"BWBR0024096","nummer":"9.1","artikel":"","lid":"","citeertitel":"Leidraad Invordering 2008"}')], "end_turn"),
        response([text_block(json.dumps({"elementen": [{"klasse": "Rechtsfeit", "tekst": "voorlopige aanslagen", "lid": "", "toelichting": "x", "alternatieven": []}]}))], "end_turn"),
    ])
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Leidraad Invordering 2008",
        settings=make_settings(enable_decomposition=True), llm=llm, graph=FakeGraph(result=bep_tsv),
    ))
    doel = next(e for e in events if e["type"] == "doel")["doel"]
    assert doel["nummer"] == "9.1" and doel["artikel"] == "9.1"
    elementen = [e["element"] for e in events if e["type"] == "element"]
    assert len(elementen) == 1
    assert elementen[0]["vindplaats"] == "BWBR0024096 art. 9.1"


def test_gewone_vraag_blijft_antwoord_geen_annotatie():
    llm = FakeLLM([
        response([text_block("SPECIALIST: algemeen\nPLAN: direct")], "end_turn"),  # supervisor → antwoord
        response([text_block("1. Wat is de termijn?")], "end_turn"),               # decompose (één regel)
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block("Zes weken (BWBR0004770 art. 9).")], "end_turn"),      # solve-antwoord
    ])
    events = _run(answer_stream(
        "wat is de betaaltermijn?", settings=make_settings(enable_decomposition=True), llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    assert not any(e["type"] in ("doel", "element") for e in events)
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Zes weken" in tokens
