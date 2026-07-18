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
            for delta in stream.text_deltas:
                writer({"type": "token", "content": delta})
            final = stream.final_message()

        tool_uses: list[dict[str, Any]] = []
        text_parts: list[str] = []
        for block in final.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_uses.append({"id": block.id, "name": block.name, "input": block.input})

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
        return {"sources": src_dicts, "entities_seen": new}

    g = StateGraph(State)
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("verify", verify_node)
    g.add_node("correct", correct_node)
    g.add_node("finalize", finalize_node)

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
