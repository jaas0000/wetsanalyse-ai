"""Generieke runtime-instellingen (key/value) bovenop de store.

Dunne service rond `JobStore.lees_app_setting`/`schrijf_app_setting` met een korte in-proces
TTL-cache, zodat een vaak-gelezen toggle (zoals `capture_llm_calls`, gelezen bij élke LLM-call)
niet telkens een DB-hit kost. De cache wordt bij een set meteen ververst.

Bewust een aparte module (vgl. profiles/wetten): de instellingen zijn DB-backed en
runtime-beheerbaar via /v1/admin/settings + het /beheer-scherm, los van de env-`Settings`.
"""

from __future__ import annotations

import time

from .jobstore import JobStore

CAPTURE_LLM_CALLS = "capture_llm_calls"
CHAT_ENABLED = "chat_enabled"
CHAT_WEBHOOK_URL = "chat_webhook_url"
CHAT_SECRET = "chat_secret"

# Korte cache: (waarde, vervaltijd) per sleutel. TTL bewust kort — een toggle moet snel doorwerken.
_TTL_S = 10.0
_cache: dict[str, tuple[object, float]] = {}


def _nu() -> float:
    return time.monotonic()


async def lees(store: JobStore, key: str, default=None):
    """Lees een instelling met TTL-cache; valt terug op `default` als de sleutel ontbreekt."""
    treffer = _cache.get(key)
    if treffer is not None and treffer[1] > _nu():
        return treffer[0]
    waarde = await store.lees_app_setting(key)
    if waarde is None:
        waarde = default
    _cache[key] = (waarde, _nu() + _TTL_S)
    return waarde


async def schrijf(store: JobStore, key: str, value) -> None:
    """Persisteer een instelling en ververs de cache meteen."""
    await store.schrijf_app_setting(key, value)
    _cache[key] = (value, _nu() + _TTL_S)


async def capture_enabled(store: JobStore) -> bool:
    """Staat het vastleggen van LLM-calls aan? Default uit (opt-in via /beheer)."""
    return bool(await lees(store, CAPTURE_LLM_CALLS, default=False))


async def set_capture(store: JobStore, aan: bool) -> None:
    await schrijf(store, CAPTURE_LLM_CALLS, bool(aan))


async def chat_enabled(store: JobStore) -> bool:
    """Staat de kennisgraaf-chatbot aan voor de webapp? Default uit (aan via /beheer)."""
    return bool(await lees(store, CHAT_ENABLED, default=False))


async def chat_config(store: JobStore) -> tuple[bool, str, str]:
    """(enabled, webhook_url, secret) van de chatbot uit de runtime-instellingen."""
    enabled = bool(await lees(store, CHAT_ENABLED, default=False))
    url = str(await lees(store, CHAT_WEBHOOK_URL, default="") or "")
    secret = str(await lees(store, CHAT_SECRET, default="") or "")
    return enabled, url, secret


async def set_chat(
    store: JobStore,
    *,
    enabled: bool | None = None,
    webhook_url: str | None = None,
    secret: str | None = None,
) -> None:
    """Persisteer de chat-instellingen; alleen niet-``None`` velden worden gewijzigd. Een leeg
    ``secret`` laat de bestaande waarde staan (voorkomt per ongeluk wissen bij een lege UI-input)."""
    if enabled is not None:
        await schrijf(store, CHAT_ENABLED, bool(enabled))
    if webhook_url is not None:
        await schrijf(store, CHAT_WEBHOOK_URL, str(webhook_url).strip())
    if secret:
        await schrijf(store, CHAT_SECRET, str(secret))


def _wis_cache() -> None:
    """Alleen voor tests: maak de in-proces cache leeg."""
    _cache.clear()
