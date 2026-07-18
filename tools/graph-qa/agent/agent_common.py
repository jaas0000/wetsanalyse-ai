"""Kleine helpers gedeeld door de wrapper (agent.py) en de orkestrator."""
from __future__ import annotations

import asyncio


def truncate(text: str, max_chars: int = 8000) -> str:
    if len(text) > max_chars:
        return text[:max_chars] + f"\n...[resultaat ingekort op {max_chars} tekens]"
    return text


async def run_sync(fn, *args):
    """Draai een blocking functie in de default executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn, *args)
