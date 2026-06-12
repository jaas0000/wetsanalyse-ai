"""Dependency-wiring. MongoStore is altijd beschikbaar; de engine vereist LLM-config
en wordt lui gebouwd zodat read/serve zonder LiteLLM draait."""

from __future__ import annotations

import asyncio
from functools import lru_cache

from .config import get_settings
from .mongo_store import MongoStore
from .wettenbank import WettenbankClient

_tasks: set[asyncio.Task] = set()


def schedule(coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@lru_cache
def get_store() -> MongoStore:
    return MongoStore(get_settings())


@lru_cache
def get_engine():
    from .engine.orchestrator import WetsanalyseEngine
    from .llm.litellm_client import build_llm_client

    settings = get_settings()
    llm = build_llm_client(settings)
    return WetsanalyseEngine(settings, get_store(), llm, WettenbankClient(settings))
