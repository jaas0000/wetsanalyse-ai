"""PR 2.3: LangGraph-orkestrator — plan→retrieve→reason→verify + streaming."""
from __future__ import annotations

import asyncio

from agent.agent import answer_stream
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block, tool_block

ART_IRI = "https://ipalm.nl/bwb/BWBR0004770/artikel/9"


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def test_volledige_stroom_plan_tools_verify_finalize():
    settings = make_settings()  # planning AAN
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
    settings = make_settings(enable_planning=False)
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
    settings = make_settings(enable_planning=False, grounding_correct=True)
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


def test_beurt_narratie_krijgt_alinea_scheiding():
    # Regressie: tekst van beurt 1 ("…op.") plakte aan beurt 2 ("De definitie…") vast omdat de
    # tokens met "" werden samengevoegd. Op de beurt-grens hoort nu één alinea-scheiding.
    settings = make_settings(enable_planning=False)
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:tekst 'x' .")
    llm = FakeLLM([
        response([
            text_block("Ik zoek nu op."),
            tool_block("t1", "get_artikel", {"bwb_id": "BWBR0004770", "artikel": "9"}),
        ], "tool_use"),
        response([text_block("De definitie is helder.")], "end_turn"),
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    tekst = "".join(e["content"] for e in events if e["type"] == "token")
    assert "op.De" not in tekst                       # niet meer vastgeplakt
    assert "Ik zoek nu op.\n\nDe definitie is helder." in tekst


def test_decompositie_deelvragen_retrieval_en_synthese():
    settings = make_settings(enable_decomposition=True)
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:tekst 'zes weken' .")
    llm = FakeLLM([
        response([text_block("SPECIALIST: algemeen\nPLAN: opsplitsen")], "end_turn"),               # router
        response([text_block("1. Wat is de termijn?\n2. Wie is de belastingschuldige?")], "end_turn"),  # decompose
        response([tool_block("t1", "get_artikel", {"bwb_id": "BWBR0004770", "artikel": "9"})], "tool_use"),  # dv1 turn1
        response([text_block(f"Termijn: zes weken ({ART_IRI}).")], "end_turn"),                       # dv1 turn2
        response([text_block(f"Belastingschuldige: degene te wiens naam ({ART_IRI}).")], "end_turn"),  # dv2 (direct)
        response([text_block(f"Samenvatting: zes weken; belastingschuldige is degene ({ART_IRI}).")], "end_turn"),  # synthese
    ])
    events = _run(answer_stream("samengestelde vraag", settings=settings, llm=llm, graph=graph))
    types = [e["type"] for e in events]

    # opsplitsing + per-deelvraag status
    assert any(e["type"] == "status" and "Opgesplitst in 2 deelvragen" in e["message"] for e in events)
    assert any(e["type"] == "status" and "Deelvraag 1/2" in e["message"] for e in events)
    assert any(e["type"] == "status" and "Deelvraag 2/2" in e["message"] for e in events)
    # alleen de synthese streamt tokens (deelvraag-narratie niet)
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Samenvatting" in tokens
    assert "Termijn: zes weken" not in tokens
    # retrieval echt uitgevoerd; bronnen uit de trace; volgorde sources→grounding→done
    assert graph.queries
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    assert ART_IRI in [s["uri"] for s in sources]
    assert types.index("sources") < types.index("grounding") < types.index("done")


def test_decompositie_een_deelvraag_slaat_synthese_over():
    # Simpele vraag → decompose geeft één deelvraag → solve streamt direct, GEEN synthese-call.
    settings = make_settings(enable_decomposition=True)
    graph = FakeGraph(result=f"<{ART_IRI}> bwb:tekst 'zes weken' .")
    llm = FakeLLM([
        response([text_block("SPECIALIST: algemeen\nPLAN: direct")], "end_turn"),           # router
        response([text_block("1. Wat is de termijn?")], "end_turn"),                          # decompose (één regel)
        response([tool_block("t1", "get_artikel", {"bwb_id": "BWBR0004770", "artikel": "9"})], "tool_use"),  # solve turn1
        response([text_block(f"Termijn: zes weken ({ART_IRI}).")], "end_turn"),               # solve turn2 (antwoord)
        # géén synthese-respons: als synthesize tóch liep, zou FakeLLM._next een IndexError geven.
    ])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    assert llm.index == 4                                    # router+decompose+2×solve; synthese niet gedraaid
    assert not any("Opgesplitst in" in e.get("message", "") for e in events)
    # het sub-antwoord is direct gestreamd
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "Termijn: zes weken" in tokens
    sources = next(e for e in events if e["type"] == "sources")["sources"]
    assert ART_IRI in [s["uri"] for s in sources]
    assert "done" in [e["type"] for e in events]


def test_decompositie_uit_geen_deelvraag_status():
    # Regressie: met de toggle uit is er geen decompositie-gedrag.
    settings = make_settings(enable_planning=False)
    graph = FakeGraph(result=ART_IRI)
    llm = FakeLLM([response([text_block("Direct antwoord.")], "end_turn")])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    assert not any(e["type"] == "status" and "Deelvraag" in e.get("message", "") for e in events)


def test_geen_planning_geen_plan_status():
    settings = make_settings(enable_planning=False)
    graph = FakeGraph(result=ART_IRI)
    llm = FakeLLM([response([text_block("Direct antwoord.")], "end_turn")])
    events = _run(answer_stream("vraag", settings=settings, llm=llm, graph=graph))
    assert not any(e["type"] == "status" and "Aanpak" in e.get("message", "") for e in events)
