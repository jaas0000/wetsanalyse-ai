"""WP-A + WP-C: de loop draait op fakes; bronnen komen uit de tool-trace."""
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
    graph = FakeGraph(result_text=f"<{ART_IRI}> bwb:nummer 9 .")
    llm = FakeLLM([
        response(
            [text_block("Ik zoek het op."),
             tool_block("t1", "graphdb_sparql", {"query": "SELECT ?s WHERE { ?s ?p ?o }"})],
            "tool_use",
        ),
        # Eindantwoord met een VERZONNEN citatie die nooit uit de graaf kwam.
        response([text_block("Zie artikel 9. (verzonnen: BWBR9999999)")], "end_turn"),
    ])
    return settings, graph, llm


def test_loop_draait_en_sluit_graaf():
    settings, graph, llm = _make()
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    types = [e["type"] for e in events]
    assert "done" in types
    assert graph.closed is True
    assert graph.calls  # tool is aangeroepen
    assert llm.calls  # llm is aangeroepen


def test_bronnen_uit_tooltrace_niet_uit_modeltekst():
    settings, graph, llm = _make()
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    uris = [s["uri"] for s in sources]

    # Echte vindplaats uit de tool-output verschijnt wél...
    assert ART_IRI in uris
    # ...en de verzonnen citatie uit de modeltekst verschijnt NIET.
    assert not any("BWBR9999999" in u for u in uris)


def test_repository_id_wordt_ingevuld():
    settings, graph, llm = _make()
    _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    _name, args = graph.calls[0]
    assert args.get("repositoryId") == settings.repository_id


def test_eindtekst_behoudt_blokstructuur():
    # Twee tekstblokken mogen niet met een spatie aan elkaar geplakt worden.
    settings = Settings()
    graph = FakeGraph(result_text=ART_IRI)
    llm = FakeLLM([
        response([text_block("Regel een."), text_block("Regel twee.")], "end_turn"),
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    text = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Regel een.\n\nRegel twee." in text
