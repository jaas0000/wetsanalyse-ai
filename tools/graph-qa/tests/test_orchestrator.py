"""PR 2.3: LangGraph-orkestrator — plan→retrieve→reason→verify + streaming."""
from __future__ import annotations

import asyncio

from agent.agent import answer_stream
from agent.config import Settings
from fakes import FakeGraph, FakeLLM, response, text_block, tool_block

ART_IRI = "https://ipalm.nl/bwb/BWBR0004770/artikel/9"


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def test_volledige_stroom_plan_tools_verify_finalize():
    settings = Settings()  # planning AAN
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:tekst 'zes weken' .")
    llm = FakeLLM([
        response([text_block("Aanpak: get_artikel 9 IW.")], "end_turn"),                      # plan (create)
        response([tool_block("t1", "get_artikel", {"bwb_id": "BWBR0004770", "artikel": "9"})], "tool_use"),
        response([text_block(f"Artikel 9 IW ({ART_IRI}): zes weken.")], "end_turn"),           # eindantwoord
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    types = [e["type"] for e in events]

    assert types[0] == "status" and "Aanpak" in events[0]["message"]          # plan-node eerst
    assert any(e["type"] == "status" and "Graaf bevragen" in e["message"] for e in events)  # tools-node
    assert graph.queries                                                       # tool echt uitgevoerd
    # volgorde aan het eind: sources → grounding → done
    assert types.index("sources") < types.index("grounding") < types.index("done")
    # tokens gestreamd
    assert any(e["type"] == "token" for e in events)


def test_bronnen_uit_tooltrace_grounding_verdict():
    settings = Settings(enable_planning=False)
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:tekst 'x' .")
    llm = FakeLLM([
        response([tool_block("t1", "get_artikel", {"bwb_id": "BWBR0004770", "artikel": "9"})], "tool_use"),
        response([text_block(f"Zie {ART_IRI}. (verzonnen: BWBR9999999)")], "end_turn"),
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    grounding = next(e for e in events if e["type"] == "grounding")
    assert ART_IRI in [s["uri"] for s in sources]
    assert grounding["grounded"] is False                    # verzonnen BWB niet in trace
    assert any("BWBR9999999" in u for u in grounding["unsupported"])


def test_grounding_correctie_doet_extra_ronde():
    settings = Settings(enable_planning=False, grounding_correct=True)
    graph = FakeGraph(result="")  # geen tools → verzonnen citatie blijft ongegrond
    llm = FakeLLM([
        response([text_block("Antwoord met verzonnen BWBR9999999.")], "end_turn"),  # ronde 1: ongegrond
        response([text_block("Herzien antwoord zonder citatie.")], "end_turn"),      # correctie-ronde
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    grounding = next(e for e in events if e["type"] == "grounding")
    assert llm.index == 2                      # beide agent-rondes verbruikt (correctie liep)
    assert grounding["grounded"] is True       # na correctie gegrond
    assert "done" in [e["type"] for e in events]


def test_geen_planning_geen_plan_status():
    settings = Settings(enable_planning=False)
    graph = FakeGraph(result=ART_IRI)
    llm = FakeLLM([response([text_block("Direct antwoord.")], "end_turn")])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    assert not any(e["type"] == "status" and "Aanpak" in e.get("message", "") for e in events)
