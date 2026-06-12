"""Dependency-wiring. MongoStore is altijd beschikbaar; de engine vereist LLM-config
en wordt lui gebouwd zodat read/serve zonder LiteLLM draait."""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache

from .config import get_settings
from .jobstore import JobStore
from .mongo_store import MongoStore
from .wettenbank import WettenbankClient

logger = logging.getLogger(__name__)

_tasks: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        # Achtergrondtaken vangen hun eigen faalklassen via _guard af; komt er tóch een
        # exceptie hier uit, dan is die ongezien — log 'm i.p.v. stil te verliezen.
        logger.error("Achtergrondtaak faalde: %s", exc, exc_info=exc)


def schedule(coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_on_done)


@lru_cache
def get_store() -> JobStore:
    return MongoStore(get_settings())


@lru_cache
def get_engine():
    from .engine.orchestrator import WetsanalyseEngine
    from .llm.litellm_client import build_llm_client

    settings = get_settings()
    llm = build_llm_client(settings)
    return WetsanalyseEngine(settings, get_store(), llm, WettenbankClient(settings))
