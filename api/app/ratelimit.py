"""Lichtgewicht misbruik-/kostenbeheersing — in-process, geen extra dependency.

- Per-client sliding-window rate limit op de muterende endpoints (een FastAPI-dependency).
- `QuotaExceeded` voor beleidsgrenzen die dieper in de engine worden afgedwongen
  (max gelijktijdige analyses, token-budget).

Per proces (in-process): bij >1 replica geldt deze rate limit per replica, dus de effectieve
grens schaalt mee met het aantal replica's. De engine-grenzen (max-active-jobs, token-budget)
zijn wél DB-/provenance-gebaseerd en daarmee accuraat over replica's heen.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, status

from .auth import require_admin, require_client
from .config import get_settings

_hits: dict[str, deque[float]] = defaultdict(deque)


class QuotaExceeded(Exception):
    """Een client overschrijdt een beleidsgrens (gelijktijdige jobs / token-budget)."""


def _allow(key: str, max_requests: int, window_s: float) -> bool:
    now = time.monotonic()
    dq = _hits[key]
    while dq and dq[0] <= now - window_s:
        dq.popleft()
    if len(dq) >= max_requests:
        return False
    dq.append(now)
    return True


def reset() -> None:
    """Wis de telstaat (voor tests)."""
    _hits.clear()


def rate_limited_client(client_id: str = Depends(require_client)) -> str:
    """Als require_client, maar met per-client rate limit op muterende endpoints."""
    s = get_settings()
    if s.rate_limit_max > 0 and not _allow(client_id, s.rate_limit_max, s.rate_limit_window_s):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Te veel verzoeken; probeer later opnieuw.",
            headers={"Retry-After": str(int(s.rate_limit_window_s))},
        )
    return client_id


def rate_limited_admin_test(admin_id: str = Depends(require_admin)) -> str:
    """Als require_admin, maar met een krappe rate limit op de verbindingstest (betaalde LLM-call)."""
    s = get_settings()
    if s.admin_test_rate_max > 0 and not _allow(
        f"admin-test:{admin_id}", s.admin_test_rate_max, s.admin_test_rate_window_s
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Te veel verbindingstests; probeer later opnieuw.",
            headers={"Retry-After": str(int(s.admin_test_rate_window_s))},
        )
    return admin_id
