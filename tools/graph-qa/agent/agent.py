"""
Agent-instap: dunne wrapper rond de LangGraph-orkestrator (agent/orchestrator.py).

Behoudt de publieke `answer_stream`-signatuur en het SSE-event-contract, zodat de API
en frontend ongewijzigd blijven. De stroom (plan→retrieve→reason→verify→finalize) en de
token-streaming leven in de toestandsgraaf.

Geheugen loopt via de LangGraph-checkpointer (thread_id = conversation_id): met een
`checkpoint_db_path` durabel (AsyncSqliteSaver, de file persisteert cross-request →
continuïteit), anders in-proces (MemorySaver). De wrapper reset per beurt de
werkvelden en levert de nieuwe user-message; de append-reducer plakt die aan de
gepersisteerde historie.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from .agent_common import run_sync
from .config import Settings
from .observability import get_tracer
from .ports import GraphPort, LLMPort

logger = logging.getLogger(__name__)


def _checkpointer_ctx(settings: Settings):
    """Async context manager die de gekozen checkpointer levert."""
    path = settings.checkpoint_db_path
    if path:
        p = Path(path)
        if not p.is_absolute():
            p = Path(__file__).parent.parent / p  # stabiel t.o.v. cwd (graph-qa-root)
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        return AsyncSqliteSaver.from_conn_string(str(p))

    from langgraph.checkpoint.memory import MemorySaver

    @asynccontextmanager
    async def _mem():
        yield MemorySaver()

    return _mem()


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

    from .orchestrator import build_graph

    builder = build_graph(settings, llm, graph)
    thread_id = conversation_id or uuid.uuid4().hex
    config = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": settings.max_turns * 2 + 10,
    }
    # Per beurt: nieuwe user-message (append-reducer) + reset van de werkvelden.
    init: dict[str, Any] = {
        "question": question,
        "messages": [{"role": "user", "content": question}],
        "source_trace": [],
        "turns": 0,
        "corrected": False,
        "answer": "",
    }

    tracer = get_tracer(__name__)
    grounded = True
    try:
        async with _checkpointer_ctx(settings) as saver:
            app = builder.compile(checkpointer=saver)
            with tracer.start_as_current_span("graph_qa.answer") as span:
                async for mode, chunk in app.astream(init, config=config, stream_mode=["custom", "values"]):
                    if mode == "custom":
                        yield chunk
                    elif mode == "values" and "grounded" in chunk:
                        grounded = chunk["grounded"]
                span.set_attribute("graph_qa.grounded", grounded)
                logger.info("antwoord klaar", extra={"grounded": grounded})

        if conversation_id:
            yield {"type": "conversation_id", "conversation_id": conversation_id}
        yield {"type": "done"}

    except Exception as exc:
        logger.error("agent-fout", exc_info=True)
        yield {"type": "error", "message": f"Agent-fout: {exc}"}
    finally:
        graph.close()
