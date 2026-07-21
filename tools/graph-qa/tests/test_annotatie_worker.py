"""De annotatie-worker in de supervisor-graaf: routeren → get_lid → JSON → grounded elementen.

Draait de échte LangGraph (prod-config: decompositie aan) met FakeLLM/FakeGraph, zodat de supervisor,
de agent⇄tools-lus en annoteer_finalize samen getest zijn.
"""
from __future__ import annotations

import asyncio
import json

from agent.agent import answer_stream
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block, tool_block

# get_lid levert SPARQL-TSV met ?nummer/?tekst/?jci; JSON-string-encoded zoals de MCP.
LID_TSV = json.dumps('?nummer\t?tekst\t?jci\n"1"\t"De ontvanger verleent uitstel van betaling."@nl\t"jci"')

ANNOTATIE_JSON = json.dumps({
    "doel": {"bwbId": "BWBR0004770", "artikel": "9", "lid": "1"},
    "elementen": [
        {"klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1", "toelichting": "wie", "alternatieven": []},
        {"klasse": "Rechtsbetrekking", "tekst": "verleent uitstel van betaling", "lid": "1", "toelichting": "wat", "alternatieven": []},
    ],
})


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def test_supervisor_routeert_naar_annotatie_en_grondt_lid():
    llm = FakeLLM([
        response([text_block("WORKERS: annotatie\nPLAN: annoteer art 9 lid 1")], "end_turn"),  # supervisor
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block(ANNOTATIE_JSON)], "end_turn"),                                     # agent → JSON
    ])
    graph = FakeGraph(result=LID_TSV)
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True), llm=llm, graph=graph,
    ))

    doel = next(e for e in events if e["type"] == "doel")["doel"]
    assert doel == {"bwbId": "BWBR0004770", "artikel": "9", "lid": "1"}

    elementen = [e["element"] for e in events if e["type"] == "element"]
    assert {el["klasse"] for el in elementen} == {"Rechtssubject", "Rechtsbetrekking"}
    for el in elementen:
        assert el["grounded"] is True
        assert el["vindplaats"] == "BWBR0004770 art. 9 lid 1"  # scope_lid uit doel.lid

    # de JSON is NIET als tokens naar de user gestreamd; alleen de samenvatting
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "elementen voorgesteld" in tokens
    assert "{" not in tokens
    assert graph.closed


def test_doel_lid_komt_uit_toolcall_ook_als_json_leeg():
    # Het model laat doel.lid leeg, maar riep get_lid(lid="1") aan → doel.lid moet toch "1" zijn
    # (anders haalt de viewer het hele artikel op).
    json_zonder_lid = json.dumps({
        "doel": {"bwbId": "BWBR0004770", "artikel": "9", "lid": ""},
        "elementen": [{"klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1", "toelichting": "", "alternatieven": []}],
    })
    llm = FakeLLM([
        response([text_block("WORKERS: annotatie\nPLAN: annoteer art 9 lid 1")], "end_turn"),
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block(json_zonder_lid)], "end_turn"),
    ])
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 IW", settings=make_settings(enable_decomposition=True),
        llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    assert next(e for e in events if e["type"] == "doel")["doel"]["lid"] == "1"
    assert [e["element"] for e in events if e["type"] == "element"][0]["vindplaats"] == "BWBR0004770 art. 9 lid 1"


def test_gewone_vraag_blijft_antwoord_geen_annotatie():
    # Een QA-vraag (geen WORKERS-regel → backward-compat antwoord) routeert niet naar annotatie.
    llm = FakeLLM([
        response([text_block("SPECIALIST: algemeen\nPLAN: direct")], "end_turn"),  # supervisor → antwoord
        response([text_block("1. Wat is de termijn?")], "end_turn"),               # decompose (één regel)
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block("Zes weken (BWBR0004770 art. 9).")], "end_turn"),      # solve-antwoord
    ])
    graph = FakeGraph(result=LID_TSV)
    events = _run(answer_stream(
        "wat is de betaaltermijn?", settings=make_settings(enable_decomposition=True), llm=llm, graph=graph,
    ))
    assert not any(e["type"] in ("doel", "element") for e in events)
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Zes weken" in tokens
