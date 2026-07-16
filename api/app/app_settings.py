"""Generieke runtime-instellingen (key/value) bovenop de store.

Dunne service rond `JobStore.lees_app_setting`/`schrijf_app_setting` met een korte in-proces
TTL-cache, zodat een vaak-gelezen toggle (zoals `capture_llm_calls`, gelezen bij élke LLM-call)
niet telkens een DB-hit kost. De cache wordt bij een set meteen ververst.

Bewust een aparte module (vgl. profiles/wetten): de instellingen zijn DB-backed en
runtime-beheerbaar via /v1/admin/settings + het /beheer-scherm, los van de env-`Settings`.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from urllib.parse import urlsplit

from . import secrets_crypto
from .jobstore import JobStore

logger = logging.getLogger(__name__)

CAPTURE_LLM_CALLS = "capture_llm_calls"
CHAT_ENABLED = "chat_enabled"
CHAT_WEBHOOK_URL = "chat_webhook_url"
CHAT_SECRET = "chat_secret"


def veilige_webhook_url(url: str) -> str:
    """Valideer de chat-webhook-URL (tweede verdedigingslinie tegen SSRF, náást `require_admin`).

    Een lege string is toegestaan (wist de instelling). Anders moet het een ``http(s)``-URL met host
    zijn en mag de host geen loopback/private/link-local/gereserveerd IP of ``localhost`` zijn. Doet
    bewust géén DNS-resolutie (geen netwerk in een validator); dit vangt de directe interne-adres-
    gevallen af. Gooit ``ValueError`` bij een ongeldige URL (→ 422 via de Pydantic-validator)."""
    schoon = (url or "").strip()
    if not schoon:
        return ""
    delen = urlsplit(schoon)
    if delen.scheme not in ("http", "https") or not delen.hostname:
        raise ValueError("Webhook-URL moet een http(s)-URL met host zijn.")
    host = delen.hostname
    if host.lower() == "localhost":
        raise ValueError("Webhook-URL mag geen interne/loopback-host zijn.")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (
        ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_unspecified
    ):
        raise ValueError("Webhook-URL mag geen interne/loopback-host zijn.")
    return schoon


def _ontsleutel_secret(ruw: str) -> str:
    """Ontsleutel het opgeslagen chat-secret. Legacy-tolerant: een bestaande plaintext-waarde (of
    ontbrekende master key) wordt ongewijzigd teruggegeven i.p.v. de chat te breken."""
    if not ruw:
        return ""
    if secrets_crypto.crypto_beschikbaar():
        try:
            return secrets_crypto.decrypt(ruw)
        except secrets_crypto.SecretsCryptoError:
            return ruw  # bestaand plaintext-secret (stille migratie bij de volgende write)
    return ruw

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
    secret = _ontsleutel_secret(str(await lees(store, CHAT_SECRET, default="") or ""))
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
        await schrijf(store, CHAT_WEBHOOK_URL, veilige_webhook_url(webhook_url))
    if secret:
        opslag = str(secret)
        if secrets_crypto.crypto_beschikbaar():
            opslag = secrets_crypto.encrypt(opslag)  # versleuteld-at-rest, net als de LLM-keys
        else:
            logger.warning("Geen master key: chat_secret wordt onversleuteld opgeslagen.")
        await schrijf(store, CHAT_SECRET, opslag)


def _wis_cache() -> None:
    """Alleen voor tests: maak de in-proces cache leeg."""
    _cache.clear()
