"""
Agent-instap: dunne wrapper rond de LangGraph-orkestrator (agent/orchestrator.py).

Behoudt de publieke `answer_stream`-signatuur en het SSE-event-contract, zodat de API
en frontend ongewijzigd blijven. De echte stroom (plan→retrieve→reason→verify→finalize)
en de token-streaming leven in de toestandsgraaf; deze wrapper bouwt de app met de
geïnjecteerde/afgeleide providers, streamt de custom-events als SSE, en beheert
history + graaf-lifecycle.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from .agent_common import run_sync
from .config import Settings
from .memory import load_history, save_turn
from .observability import get_tracer
from .ports import GraphPort, LLMPort

logger = logging.getLogger(__name__)


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
      {"type": "status", "message": "..."}
      {"type": "token", "content": "..."}
      {"type": "sources", "sources": [...]}
      {"type": "grounding", "grounded": bool, "unsupported": [...]}
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
        await run_sync(graph.initialize)
    except Exception as exc:
        logger.warning("MCP-verbinding mislukt", exc_info=True)
        yield {"type": "error", "message": f"MCP-verbinding mislukt: {exc}"}
        if graph is not None:
            graph.close()
        return

    from .orchestrator import build_app

    app = build_app(settings, llm, graph)
    history = load_history(conversation_id) if conversation_id else []
    init: dict[str, Any] = {
        "question": question,
        "messages": history + [{"role": "user", "content": question}],
        "source_trace": [],
        "turns": 0,
        "corrected": False,
    }
    config = {"recursion_limit": settings.max_turns * 2 + 10}

    tracer = get_tracer(__name__)
    final_answer = ""
    grounded = True
    try:
        with tracer.start_as_current_span("graph_qa.answer") as span:
            async for mode, chunk in app.astream(init, config=config, stream_mode=["custom", "values"]):
                if mode == "custom":
                    yield chunk
                elif mode == "values":
                    if chunk.get("answer"):
                        final_answer = chunk["answer"]
                    if "grounded" in chunk:
                        grounded = chunk["grounded"]

            span.set_attribute("graph_qa.grounded", grounded)
            logger.info("antwoord klaar", extra={"grounded": grounded})

        if conversation_id and final_answer:
            await run_sync(save_turn, conversation_id, question, final_answer)
            yield {"type": "conversation_id", "conversation_id": conversation_id}
        yield {"type": "done"}

    except Exception as exc:
        logger.error("agent-fout", exc_info=True)
        yield {"type": "error", "message": f"Agent-fout: {exc}"}
    finally:
        graph.close()
