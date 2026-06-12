"""Per-job concurrency-control.

Een in-process `asyncio.Lock` per job serialiseert de state-transities van de orchestrator.
Dit codificeert de single-worker/single-replica-aanname: de lock werkt niet over processen of
containers heen. Horizontaal schalen vereist een gedeelde lock (Mongo state-CAS) of een
job-queue (zie roadmap). Bewust losgekoppeld van de persistentielaag — concurrency is een
orchestratie-zorg, geen opslagdetail.
"""

from __future__ import annotations

import asyncio

_locks: dict[str, asyncio.Lock] = {}


def lock_for(job_id: str) -> asyncio.Lock:
    return _locks.setdefault(job_id, asyncio.Lock())


def discard_lock(job_id: str) -> None:
    """Verwijder de lock van een job (bv. na delete) zodat de registry niet onbegrensd groeit."""
    _locks.pop(job_id, None)
