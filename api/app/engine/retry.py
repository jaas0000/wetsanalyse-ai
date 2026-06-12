"""Bounded retry met exponentiële backoff op transiënte LLM/MCP-fouten.

De LLM-adapter laat provider-fouten (rate-limit/5xx/timeout) rauw propageren en de MCP-client
verpakt transportfouten in WettenbankError. Beide zijn vaak tijdelijk; één hapering mag niet de
hele (mogelijk half afgeronde) job terminaal naar `fout` duwen. Permanente fouten (onbekende wet,
ongeldige config) zijn niet transiënt en worden niet geretryed.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# LiteLLM-exceptieklassen die een tijdelijke conditie aanduiden. Op naam i.p.v. import,
# zodat de engine niet hard van litellm afhankelijk wordt.
_TRANSIENTE_LLM_NAMEN = {
    "RateLimitError",
    "Timeout",
    "APITimeoutError",
    "APIConnectionError",
    "InternalServerError",
    "ServiceUnavailableError",
}


def is_transient(e: BaseException) -> bool:
    from ..wettenbank import WettenbankError

    if isinstance(e, WettenbankError):
        return True
    return type(e).__name__ in _TRANSIENTE_LLM_NAMEN


async def met_retry(maak, *, max_retries: int, backoff: float):
    """Roep de coroutine-factory `maak` aan; herhaal bij een transiënte fout met backoff."""
    poging = 0
    while True:
        try:
            return await maak()
        except Exception as e:  # noqa: BLE001 — niet-transiënt wordt direct doorgegooid
            if poging >= max_retries or not is_transient(e):
                raise
            wacht = backoff * (2 ** poging)
            logger.warning(
                "Transiënte fout (%s); retry %d/%d na %.1fs",
                type(e).__name__, poging + 1, max_retries, wacht,
            )
            await asyncio.sleep(wacht)
            poging += 1
