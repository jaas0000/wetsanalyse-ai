"""
LangGraph-orkestrator: plan → retrieve → reason → verify → finalize.

LangGraph levert het toestandsgraaf-substraat (nodes, conditionele edges, streaming);
de domeinlogica blijft die van Fase 1/2 — de nodes roepen de bestaande LLMPort/GraphPort,
de typed tool-registry, provenance en grounding aan. Geen langchain-chatmodel: Azure
Foundry blijft via AnthropicLLM.

Streaming loopt via LangGraph's custom-stream: nodes emitteren onze SSE-events
(status/token/sources/grounding) met get_stream_writer(); answer_stream consumeert ze
via app.astream(stream_mode="custom") en houdt het API/frontend-contract exact gelijk.
De nodes zijn synchroon (LangGraph draait ze in een threadpool), zodat de blocking
LLM-/MCP-calls de event-loop niet blokkeren.
"""
from __future__ import annotations

from typing import Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from .agent_common import truncate
from .config import Settings
from .grounding import check_grounding, curate_sources
from .ports import GraphPort, LLMPort
from .prompts import SYSTEM_PROMPT
from .provenance import collect_sources
from .tools import anthropic_schemas, dispatch

_PLAN_SYSTEM = (
    "Je plant de aanpak voor een juridische vraag over de kennisgraaf. Geef in 1-3 zinnen "
    "welke bepalingen of tools je gaat raadplegen om de vraag te beantwoorden — GEEN antwoord, "
    "alleen de aanpak. Gaat de vraag niet over de Nederlandse wet- en regelgeving in de graaf, "
    "antwoord dan uitsluitend: AFWIJZEN."
)


class State(TypedDict, total=False):
    question: str
    messages: list[dict[str, Any]]
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


def build_app(settings: Settings, llm: LLMPort, graph: GraphPort):
    """Bouw en compileer de toestandsgraaf met de deps via closure (DI blijft)."""
    tool_schemas = anthropic_schemas()
    model = settings.llm_model

    def plan_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        writer({"type": "status", "message": "Aanpak bepalen..."})
        resp = llm.create(
            model=model,
            max_tokens=300,
            system=_PLAN_SYSTEM,
            tools=[],
            messages=[{"role": "user", "content": state["question"]}],
        )
        plan = "".join(b.text for b in resp.content if b.type == "text").strip()
        return {"plan": plan}

    def agent_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        system = SYSTEM_PROMPT
        if state.get("plan"):
            system = f"{SYSTEM_PROMPT}\n\nAANPAK (door jou gepland):\n{state['plan']}"

        with llm.stream(
            model=model,
            max_tokens=4096,
            system=system,
            tools=tool_schemas,
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
        messages = state["messages"] + [{"role": "assistant", "content": assistant_content}]

        upd: dict[str, Any] = {
            "messages": messages,
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
        messages = list(state["messages"])
        trace = list(state.get("source_trace", []))
        results = []
        for tu in pending:
            result_text = truncate(dispatch(tu["name"], graph, tu["input"]))
            trace.append((tu["name"], result_text))
            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
        messages.append({"role": "user", "content": results})
        return {"messages": messages, "source_trace": trace, "pending_tools": []}

    def verify_node(state: State) -> dict[str, Any]:
        report = check_grounding(state.get("answer", ""), state.get("source_trace", []))
        return {"grounded": report.grounded, "cited": len(report.cited), "unsupported": report.unsupported}

    def route_after_verify(state: State) -> str:
        if not state.get("grounded", True) and settings.grounding_correct and not state.get("corrected"):
            return "correct"
        return "finalize"

    def correct_node(state: State) -> dict[str, Any]:
        bad = ", ".join(state.get("unsupported", []))
        messages = list(state["messages"])
        messages.append({
            "role": "user",
            "content": (
                f"Let op: je noemde verwijzing(en) {bad} die niet uit de graaf-resultaten kwamen. "
                "Corrigeer je antwoord: onderbouw ze met de tools of verwijder ze."
            ),
        })
        return {"messages": messages, "corrected": True, "answer": ""}

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
        return {"sources": src_dicts}

    g = StateGraph(State)
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("verify", verify_node)
    g.add_node("correct", correct_node)
    g.add_node("finalize", finalize_node)

    if settings.enable_planning:
        g.add_node("plan", plan_node)
        g.add_edge(START, "plan")
        g.add_edge("plan", "agent")
    else:
        g.add_edge(START, "agent")

    g.add_conditional_edges("agent", route_after_agent, {"tools": "tools", "verify": "verify"})
    g.add_edge("tools", "agent")
    g.add_conditional_edges("verify", route_after_verify, {"correct": "correct", "finalize": "finalize"})
    g.add_edge("correct", "agent")
    g.add_edge("finalize", END)

    return g.compile()
