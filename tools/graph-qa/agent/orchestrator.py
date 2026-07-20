"""
LangGraph-orkestrator: plan → retrieve → reason → verify → finalize.

LangGraph levert het toestandsgraaf-substraat (nodes, conditionele edges, streaming,
checkpointing); de domeinlogica blijft die van Fase 1/2 — de nodes roepen de bestaande
LLMPort/GraphPort, de typed tool-registry, provenance en grounding aan. Geen
langchain-chatmodel: Azure Foundry blijft via AnthropicLLM.

Geheugen zit in de state en wordt door de checkpointer (thread_id = conversation_id)
gepersisteerd: `messages` (episodisch, append-reducer) en `entities_seen` (de "in
beeld"-set geraadpleegde bepalingen, semantische/entiteit-tier). De wrapper compileert
`build_graph()` met de gekozen checkpointer.

Streaming loopt via LangGraph's custom-stream (get_stream_writer); answer_stream
consumeert het en houdt het SSE-contract gelijk. Nodes zijn synchroon (threadpool),
zodat de blocking LLM-/MCP-calls de event-loop niet blokkeren.
"""
from __future__ import annotations

import operator
import re
from typing import Annotated, Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from .agent_common import truncate
from .config import Settings
from .grounding import check_grounding, curate_sources
from .ports import GraphPort, LLMPort
from .prompts import SYSTEM_PROMPT
from .provenance import collect_sources
from .specialists import get as get_specialist
from .tools import anthropic_schemas, dispatch

_ROUTER_SYSTEM = (
    "Je routeert een juridische vraag over de kennisgraaf naar een specialist en schetst kort de "
    "aanpak. Antwoord in EXACT dit formaat, twee regels:\n"
    "SPECIALIST: <definitie|duiding|algemeen>\n"
    "PLAN: <1-2 zinnen aanpak, of AFWIJZEN als de vraag niet over de Nederlandse wet- en "
    "regelgeving in de graaf gaat>\n"
    "Kies 'definitie' voor begrip-/definitievragen, 'duiding' voor de betekenis/structuur/samenhang "
    "van een bepaling, anders 'algemeen'."
)

_DECOMPOSE_SYSTEM = (
    "Je splitst een juridische vraag over de kennisgraaf op in de deelvragen die je apart moet "
    "beantwoorden om de hele vraag te dekken. Geef ELKE deelvraag op een eigen regel, genummerd "
    "(1., 2., …), in logische volgorde (een deelvraag mag voortbouwen op een eerdere). Splits ALLEEN "
    "als de vraag echt meerdere losse onderdelen heeft; een enkelvoudige vraag geef je als één regel "
    "terug (de vraag zelf). Verzin geen deelvragen die niet in de oorspronkelijke vraag besloten "
    "liggen. Geen inleiding of uitleg — alleen de genummerde regels."
)

_SYNTHESE_SYSTEM = (
    "Je stelt één samenhangend eindantwoord samen uit de per-deelvraag verzamelde bevindingen. "
    "Steun UITSLUITEND op die bevindingen — voeg geen nieuwe feiten toe en verzin geen vindplaatsen. "
    "Behoud de vindplaatsen (regeling/artikel/lid) letterlijk zoals ze in de bevindingen staan. "
    "Antwoord bondig en goed gestructureerd; adresseer elk onderdeel van de oorspronkelijke vraag."
)


def _parse_final(final: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Splits een Anthropic-response in (tool_uses, text_parts)."""
    tool_uses: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for block in final.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_uses.append({"id": block.id, "name": block.name, "input": block.input})
    return tool_uses, text_parts


class State(TypedDict, total=False):
    question: str
    messages: Annotated[list[dict[str, Any]], operator.add]      # episodisch, gepersisteerd
    entities_seen: Annotated[list[str], operator.add]            # semantisch/entiteit-tier
    specialist: str
    plan: str
    source_trace: list[tuple[str, str]]
    answer: str
    grounded: bool
    cited: int
    unsupported: list[str]
    sources: list[dict[str, Any]]
    pending_tools: list[dict[str, Any]]
    turns: int
    corrected: bool
    # Decompositie (multi-hop): deelvragen + per-deelvraag bevindingen (last-value-wins;
    # solve_node zet ze in één keer). De per-deelvraag agent⇄tools-loop draait lokaal in solve_node.
    sub_questions: list[str]
    sub_findings: list[dict[str, str]]


def build_graph(settings: Settings, llm: LLMPort, graph: GraphPort) -> StateGraph:
    """Bouw de (ongecompileerde) toestandsgraaf; de wrapper compileert 'm met een checkpointer."""
    model = settings.llm_model

    def _memory_context(state: State) -> str:
        if not settings.enable_memory_context:
            return ""
        seen = list(dict.fromkeys(state.get("entities_seen") or []))  # dedup, volgorde behouden
        if not seen:
            return ""
        lijst = "\n".join(f"- {u}" for u in seen[-12:])
        return (
            "\n\nGESPREKSCONTEXT — eerder in dit gesprek geraadpleegde bepalingen (alléén als "
            "aanknopingspunt voor verwijzingen als 'dat artikel'; verifieer elk feit opnieuw via "
            f"de tools):\n{lijst}"
        )

    def router_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        resp = llm.create(
            model=model,
            max_tokens=300,
            system=_ROUTER_SYSTEM + _memory_context(state),
            tools=[],
            messages=[{"role": "user", "content": state["question"]}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        specialist, plan = "algemeen", ""
        for line in text.splitlines():
            low = line.strip()
            if low.upper().startswith("SPECIALIST:"):
                val = low.split(":", 1)[1].strip().lower()
                if val in ("definitie", "duiding", "algemeen"):
                    specialist = val
            elif low.upper().startswith("PLAN:"):
                plan = low.split(":", 1)[1].strip()
        if not plan:
            plan = text.strip()
        writer({"type": "status", "message": f"Specialist: {specialist} — {plan[:80]}"})
        return {"specialist": specialist, "plan": plan}

    def agent_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        spec = get_specialist(state.get("specialist"))
        system = SYSTEM_PROMPT
        if spec.system:
            system = f"{system}\n\n{spec.system}"
        if state.get("plan"):
            system = f"{system}\n\nAANPAK (door jou gepland):\n{state['plan']}"
        system += _memory_context(state)

        with llm.stream(
            model=model,
            max_tokens=4096,
            system=system,
            tools=anthropic_schemas(only=spec.tools),
            messages=state["messages"],
        ) as stream:
            # Beurt-narratie stroomt per beurt binnen; op een beurt-grens ontbreekt anders een
            # scheiding, zodat "…tegelijkertijd." + "De thesaurus…" aan elkaar plakt. Emit één
            # alinea-scheiding vóór de éérste tekst van een vervolgbeurt (turns>0). Lazy, zodat
            # een tool-only beurt (geen tekst) geen loshangende of dubbele witregel geeft.
            first_delta = True
            for delta in stream.text_deltas:
                if first_delta and state.get("turns", 0) > 0:
                    writer({"type": "token", "content": "\n\n"})
                first_delta = False
                writer({"type": "token", "content": delta})
            final = stream.final_message()

        tool_uses, text_parts = _parse_final(final)

        assistant_content: list[dict[str, Any]] = [{"type": "text", "text": p} for p in text_parts]
        assistant_content += [
            {"type": "tool_use", "id": t["id"], "name": t["name"], "input": t["input"]}
            for t in tool_uses
        ]

        upd: dict[str, Any] = {
            "messages": [{"role": "assistant", "content": assistant_content}],  # delta (append-reducer)
            "pending_tools": tool_uses,
            "turns": state.get("turns", 0) + 1,
        }
        if not tool_uses:
            upd["answer"] = "\n\n".join(p for p in text_parts if p)
        return upd

    def route_after_agent(state: State) -> str:
        if state.get("pending_tools") and state.get("turns", 0) < settings.max_turns:
            return "tools"
        return "verify"

    def tools_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        pending = state.get("pending_tools", [])
        writer({"type": "status", "message": f"Graaf bevragen: {', '.join(t['name'] for t in pending)}..."})
        trace = list(state.get("source_trace", []))
        results = []
        for tu in pending:
            result_text = truncate(dispatch(tu["name"], graph, tu["input"], settings))
            trace.append((tu["name"], result_text))
            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
        return {
            "messages": [{"role": "user", "content": results}],  # delta
            "source_trace": trace,
            "pending_tools": [],
        }

    def verify_node(state: State) -> dict[str, Any]:
        report = check_grounding(state.get("answer", ""), state.get("source_trace", []))
        return {"grounded": report.grounded, "cited": len(report.cited), "unsupported": report.unsupported}

    def route_after_verify(state: State) -> str:
        if not state.get("grounded", True) and settings.grounding_correct and not state.get("corrected"):
            return "correct"
        return "finalize"

    def correct_node(state: State) -> dict[str, Any]:
        bad = ", ".join(state.get("unsupported", []))
        return {
            "messages": [{
                "role": "user",
                "content": (
                    f"Let op: je noemde verwijzing(en) {bad} die niet uit de graaf-resultaten kwamen. "
                    "Corrigeer je antwoord: onderbouw ze met de tools of verwijder ze."
                ),
            }],
            "corrected": True,
            "answer": "",
        }

    def finalize_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        sources = collect_sources(state.get("source_trace", []))
        if settings.curate_sources:
            sources = curate_sources(sources, state.get("answer", ""))
        src_dicts = [s.model_dump() for s in sources]
        writer({"type": "sources", "sources": src_dicts})
        writer({
            "type": "grounding",
            "grounded": state.get("grounded", True),
            "cited": state.get("cited", 0),
            "unsupported": state.get("unsupported", []),
        })
        # entiteit-tier: alleen nieuwe IRI's toevoegen (append-reducer + dedup).
        existing = set(state.get("entities_seen") or [])
        new = [s["uri"] for s in src_dicts if s["uri"] not in existing]
        upd: dict[str, Any] = {"sources": src_dicts, "entities_seen": new}
        # In de decompositie-stroom stroomt het eind-antwoord uit synthesize_node en is het nog niet
        # in het durabele messages-kanaal beland (agent_node doet dat in de één-loop-stroom). Voeg het
        # hier één keer toe zodat het gespreksgeheugen het antwoord onthoudt.
        if settings.enable_decomposition:
            upd["messages"] = [
                {"role": "assistant", "content": [{"type": "text", "text": state.get("answer", "")}]}
            ]
        return upd

    # ---- Decompositie-nodes (multi-hop; alleen actief bij enable_decomposition) --------------------

    def decompose_node(state: State) -> dict[str, Any]:
        """Splits de vraag in geordende deelvragen (één LLM-call). Enkelvoudig → één deelvraag."""
        writer = get_stream_writer()
        resp = llm.create(
            model=model,
            max_tokens=400,
            system=_DECOMPOSE_SYSTEM + _memory_context(state),
            tools=[],
            messages=[{"role": "user", "content": state["question"]}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        subs: list[str] = []
        for line in text.splitlines():
            m = re.match(r"^\s*\d+[.)]\s*(.+)$", line)
            if m:
                subs.append(m.group(1).strip())
        if not subs:
            subs = [state["question"]]
        subs = subs[: settings.max_subquestions]
        if len(subs) > 1:
            writer({"type": "status", "message": f"Opgesplitst in {len(subs)} deelvragen."})
        return {"sub_questions": subs}

    def solve_node(state: State) -> dict[str, Any]:
        """Beantwoord elke deelvraag met een eigen agent⇄tools-loop (lokale scratch-messages).

        Bij MEERDERE deelvragen stromen de deelvraag-tokens niet naar de user (alleen de synthese
        streamt). Bij ÉÉN deelvraag (een simpele vraag) is er geen aparte synthese nodig: dan streamt
        het antwoord direct en wordt `answer` gezet, zodat een eenvoudige vraag geen synthese-tax
        betaalt. De gedeelde source_trace accumuleert over álle deelvragen zodat grounding/provenance
        ongewijzigd werken.
        """
        writer = get_stream_writer()
        spec = get_specialist(state.get("specialist"))
        subs = state.get("sub_questions") or [state["question"]]
        stream_to_user = len(subs) == 1  # simpele vraag: direct streamen, synthese overslaan
        base_system = SYSTEM_PROMPT + (f"\n\n{spec.system}" if spec.system else "")
        schemas = anthropic_schemas(only=spec.tools)
        trace = list(state.get("source_trace", []))
        findings: list[dict[str, str]] = []
        for i, sub in enumerate(subs, 1):
            if len(subs) > 1:
                writer({"type": "status", "message": f"Deelvraag {i}/{len(subs)}: {sub[:80]}"})
            system = base_system
            if findings:
                ctx = "\n".join(f"- {f['vraag']} → {f['antwoord'][:300]}" for f in findings)
                system += (
                    "\n\nEERDERE DEELBEVINDINGEN (context; verifieer elk feit opnieuw via de tools):\n" + ctx
                )
            system += _memory_context(state)
            msgs: list[dict[str, Any]] = [{"role": "user", "content": sub}]
            antwoord = ""
            for _turn in range(settings.sub_max_turns):
                with llm.stream(
                    model=model, max_tokens=4096, system=system, tools=schemas, messages=msgs,
                ) as stream:
                    first = True
                    for delta in stream.text_deltas:
                        if stream_to_user:
                            if first and _turn > 0:
                                writer({"type": "token", "content": "\n\n"})  # alinea-scheiding tussen beurten
                            writer({"type": "token", "content": delta})
                        first = False
                    final = stream.final_message()
                tool_uses, text_parts = _parse_final(final)
                assistant_content: list[dict[str, Any]] = [{"type": "text", "text": p} for p in text_parts]
                assistant_content += [
                    {"type": "tool_use", "id": t["id"], "name": t["name"], "input": t["input"]}
                    for t in tool_uses
                ]
                msgs.append({"role": "assistant", "content": assistant_content})
                if not tool_uses:
                    antwoord = "\n\n".join(p for p in text_parts if p)
                    break
                writer({"type": "status", "message": f"Graaf bevragen: {', '.join(t['name'] for t in tool_uses)}..."})
                results = []
                for tu in tool_uses:
                    result_text = truncate(dispatch(tu["name"], graph, tu["input"], settings))
                    trace.append((tu["name"], result_text))
                    results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
                msgs.append({"role": "user", "content": results})
            findings.append({"vraag": sub, "antwoord": antwoord})
        upd: dict[str, Any] = {"sub_findings": findings, "source_trace": trace}
        if stream_to_user:
            # Simpele vraag: het gestreamde sub-antwoord ís het eind-antwoord (geen synthese).
            upd["answer"] = findings[0]["antwoord"] if findings else ""
        return upd

    def route_after_solve(state: State) -> str:
        # Eén deelvraag → antwoord staat al (gestreamd in solve); sla de synthese over.
        return "verify" if len(state.get("sub_questions") or []) <= 1 else "synthesize"

    def synthesize_node(state: State) -> dict[str, Any]:
        """Stel het eind-antwoord samen uit de deelbevindingen (streamt de tokens)."""
        writer = get_stream_writer()
        findings = state.get("sub_findings") or []
        bevindingen = "\n\n".join(
            f"DEELVRAAG: {f['vraag']}\nBEVINDING: {f['antwoord']}" for f in findings
        )
        system = _SYNTHESE_SYSTEM
        if state.get("corrected") and state.get("unsupported"):
            system += (
                "\n\nVerwijder of onderbouw deze eerder niet-gegronde verwijzingen: "
                + ", ".join(state["unsupported"]) + "."
            )
        user = f"OORSPRONKELIJKE VRAAG:\n{state['question']}\n\nBEVINDINGEN PER DEELVRAAG:\n{bevindingen}"
        parts: list[str] = []
        with llm.stream(
            model=model, max_tokens=4096, system=system, tools=[],
            messages=[{"role": "user", "content": user}],
        ) as stream:
            for delta in stream.text_deltas:
                parts.append(delta)
                writer({"type": "token", "content": delta})
            stream.final_message()
        return {"answer": "".join(parts).strip()}

    def resynth_node(state: State) -> dict[str, Any]:
        """Ongegronde synthese → markeer voor één her-synthese (synthesize_node leest corrected)."""
        return {"corrected": True, "answer": ""}

    g = StateGraph(State)
    g.add_node("verify", verify_node)
    g.add_node("finalize", finalize_node)

    if settings.enable_decomposition:
        # Multi-hop: router → decompose → solve (retrieval per deelvraag) → synthesize → verify →
        # (resynth → synthesize | finalize). De per-deelvraag agent⇄tools-loop draait lokaal in solve.
        g.add_node("router", router_node)
        g.add_node("decompose", decompose_node)
        g.add_node("solve", solve_node)
        g.add_node("synthesize", synthesize_node)
        g.add_node("resynth", resynth_node)
        g.add_edge(START, "router")
        g.add_edge("router", "decompose")
        g.add_edge("decompose", "solve")
        g.add_conditional_edges("solve", route_after_solve, {"verify": "verify", "synthesize": "synthesize"})
        g.add_edge("synthesize", "verify")
        g.add_conditional_edges("verify", route_after_verify, {"correct": "resynth", "finalize": "finalize"})
        g.add_edge("resynth", "synthesize")
        g.add_edge("finalize", END)
        return g

    # Één-loop-stroom (ongewijzigd).
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("correct", correct_node)

    if settings.enable_planning:
        g.add_node("router", router_node)
        g.add_edge(START, "router")
        g.add_edge("router", "agent")
    else:
        g.add_edge(START, "agent")

    g.add_conditional_edges("agent", route_after_agent, {"tools": "tools", "verify": "verify"})
    g.add_edge("tools", "agent")
    g.add_conditional_edges("verify", route_after_verify, {"correct": "correct", "finalize": "finalize"})
    g.add_edge("correct", "agent")
    g.add_edge("finalize", END)

    return g
