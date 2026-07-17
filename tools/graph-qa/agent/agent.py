"""
Agent-kern: tool-calling loop via een LLMPort + een GraphPort (GraphDB MCP).

Gebruikt een blocking LLM-call (niet streaming) voor betrouwbaarheid op Azure
Foundry. De FastAPI-laag stuurt na elke tool-ronde een voortgangs-event, en het
eindantwoord token-voor-token als gesimuleerde stream.

De providers worden via poorten geïnjecteerd (agent/ports.py); worden ze niet
meegegeven, dan bouwt de loop defaults uit Settings. Zo draait de loop in tests op
fakes zonder netwerk.

Stroom per vraag:
  1. Initialiseer de graaf-sessie; haal tool-definities op.
  2. Stuur vraag + system prompt naar het LLM met de MCP-tools als tool-schema.
  3. Het LLM roept tools aan → via de graaf uitvoeren → resultaat terug als tool_result.
  4. Herhaal tot stop_reason == "end_turn" (max settings.max_turns rondes).
  5. Yield het eindantwoord als tokens + bronnen (uit de tool-trace).
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from .config import Settings
from .memory import load_history, save_turn
from .mcp_client import MCPError
from .ports import GraphPort, LLMPort
from .provenance import collect_sources
from .prompts import SYSTEM_PROMPT


def _mcp_tools_to_anthropic(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for t in tools:
        schema = t.get("inputSchema", {})
        if "type" not in schema:
            schema = {"type": "object", "properties": schema}
        result.append(
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": schema,
            }
        )
    return result


def _summarize_tool_result(content_list: list[Any], max_chars: int = 8000) -> str:
    parts = []
    for item in content_list:
        if isinstance(item, dict):
            parts.append(item.get("text", str(item)))
        else:
            parts.append(str(item))
    text = "\n".join(parts)
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n...[resultaat ingekort op {max_chars} tekens]"
    return text


async def _run_sync(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)


async def answer_stream(
    question: str,
    conversation_id: str | None = None,
    *,
    settings: Settings | None = None,
    llm: LLMPort | None = None,
    graph: GraphPort | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Async generator die SSE-events yield:
      {"type": "token", "content": "..."}
      {"type": "sources", "sources": [...]}
      {"type": "done"}
      {"type": "error", "message": "..."}
    """
    settings = settings or Settings.from_env()

    # Providers: injecteer voor tests, of bouw defaults uit Settings.
    try:
        if graph is None:
            from .adapters.graphdb_graph import make_graph

            graph = make_graph(settings)
        if llm is None:
            from .adapters.anthropic_llm import AnthropicLLM

            llm = AnthropicLLM(settings)
        await _run_sync(graph.initialize)
        raw_tools = await _run_sync(graph.list_tools)
    except Exception as exc:
        yield {"type": "error", "message": f"MCP-verbinding mislukt: {exc}"}
        if graph is not None:
            graph.close()
        return

    anthropic_tools = _mcp_tools_to_anthropic(raw_tools)
    for tool in anthropic_tools:
        props = tool["input_schema"].setdefault("properties", {})
        if "repositoryId" not in props:
            props["repositoryId"] = {
                "type": "string",
                "description": f"GraphDB repository (altijd '{settings.repository_id}')",
                "default": settings.repository_id,
            }

    model = settings.llm_model

    # Laad gespreksgeschiedenis als conversation_id opgegeven
    history: list[dict[str, Any]] = []
    if conversation_id:
        history = load_history(conversation_id)

    messages: list[dict[str, Any]] = history + [{"role": "user", "content": question}]

    # Bronnen komen uit de tool-executietrace, niet uit de modeltekst.
    source_trace: list[tuple[str, str]] = []

    try:
        for _turn in range(settings.max_turns):
            # Blocking call in executor
            response = await _run_sync(
                lambda: llm.create(
                    model=model,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT,
                    tools=anthropic_tools,
                    messages=messages,
                )
            )

            stop_reason = response.stop_reason
            tool_uses = []
            text_parts = []

            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
                elif block.type == "tool_use":
                    tool_uses.append({
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            # Bouw assistant-bericht
            assistant_content: list[dict[str, Any]] = []
            for part in text_parts:
                assistant_content.append({"type": "text", "text": part})
            for tu in tool_uses:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                })
            messages.append({"role": "assistant", "content": assistant_content})

            if stop_reason != "tool_use" or not tool_uses:
                # Eindantwoord: stream tekst als tokens (bloktekst behouden, geen spatie-lijm)
                full_text = "\n\n".join(p for p in text_parts if p)
                # Stuur in chunks van ~50 tekens voor vloeiend effect
                chunk_size = 50
                for i in range(0, len(full_text), chunk_size):
                    yield {"type": "token", "content": full_text[i:i + chunk_size]}
                    await asyncio.sleep(0)  # geef event loop ruimte

                # Sla uitwisseling op in geheugen
                if conversation_id:
                    await _run_sync(save_turn, conversation_id, question, full_text)

                sources = collect_sources(source_trace)
                yield {"type": "sources", "sources": [s.model_dump() for s in sources]}
                if conversation_id:
                    yield {"type": "conversation_id", "conversation_id": conversation_id}
                yield {"type": "done"}
                return

            # Voortgangsevent: agent is tools aan het gebruiken
            tool_names = [tu["name"] for tu in tool_uses]
            yield {"type": "status", "message": f"Graaf bevragen: {', '.join(tool_names)}..."}

            # Tool-calls uitvoeren via de graaf
            tool_results: list[dict[str, Any]] = []
            for tu in tool_uses:
                args = dict(tu["input"])
                if "repositoryId" not in args or not args["repositoryId"]:
                    args["repositoryId"] = settings.repository_id

                try:
                    content_list = await _run_sync(graph.call_tool, tu["name"], args)
                    result_text = _summarize_tool_result(content_list)
                    # Registreer de trace voor bronvermelding.
                    source_trace.append((tu["name"], result_text))
                except MCPError as exc:
                    result_text = f"Fout bij tool-aanroep: {exc}"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result_text,
                })

            messages.append({"role": "user", "content": tool_results})

        # Max turns bereikt
        yield {"type": "error", "message": "Maximum aantal zoekopdrachten bereikt zonder eindantwoord."}

    except Exception as exc:
        yield {"type": "error", "message": f"Agent-fout: {exc}"}
    finally:
        graph.close()
