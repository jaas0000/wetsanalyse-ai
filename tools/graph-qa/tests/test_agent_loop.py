"""WP-A + WP-C + WP-D: de loop draait op fakes via de getypeerde toollaag."""
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


def _make():
    settings = Settings()  # defaults; secrets niet nodig want we injecteren fakes
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:citeertitel \"Invorderingswet 1990\" .")
    llm = FakeLLM([
        # Het model kiest een GETYPEERDE tool, geen rauwe SPARQL.
        response(
            [text_block("Ik zoek de regelingen op."),
             tool_block("t1", "list_regelingen", {})],
            "tool_use",
        ),
        # Eindantwoord met een VERZONNEN citatie die nooit uit de graaf kwam.
        response([text_block("Zie de Invorderingswet 1990. (verzonnen: BWBR9999999)")], "end_turn"),
    ])
    return settings, graph, llm


def test_loop_draait_via_getypeerde_tool():
    settings, graph, llm = _make()
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    assert "done" in [e["type"] for e in events]
    assert graph.closed is True
    assert graph.queries  # er is een SPARQL-query uitgevoerd
    # De uitgevoerde query is die van list_regelingen (eigen-IRI-ruimtefilter).
    assert any("bwb:Regeling" in q and "STRSTARTS" in q for q in graph.queries)


def test_bronnen_uit_tooltrace_niet_uit_modeltekst():
    settings, graph, llm = _make()
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    uris = [s["uri"] for s in sources]
    assert ART_IRI in uris  # echte vindplaats uit de tool-output
    assert not any("BWBR9999999" in u for u in uris)  # verzinsel uit de tekst niet


def test_geen_repository_id_meer_in_toolargs():
    # De domeintools kennen de repo zelf; het model krijgt geen repositoryId-veld.
    from agent.tools import anthropic_schemas

    for tool in anthropic_schemas():
        assert "repositoryId" not in tool["input_schema"].get("properties", {})


def test_eindtekst_behoudt_blokstructuur():
    settings = Settings()
    graph = FakeGraph(result=ART_IRI)
    llm = FakeLLM([
        response([text_block("Regel een."), text_block("Regel twee.")], "end_turn"),
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    text = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Regel een.\n\nRegel twee." in text
