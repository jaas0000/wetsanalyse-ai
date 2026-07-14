"""Client-facing kennisgraaf-chatbot: proxy naar de n8n-agent (GraphDB-kennisgraaf).

De webapp toont een chatbel die via de BFF hierheen praat. De webhook-URL + het secret staan in
de runtime-instellingen (`app_settings`, beheerbaar via /beheer) en blijven dus **server-side**;
de browser krijgt ze nooit te zien. `GET /v1/chat/config` geeft alleen de aan/uit-toggle terug.
De agent onthoudt de context per `sessionId`.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import app_settings
from ..auth import require_client
from ..deps import get_store
from ..jobstore import JobStore
from ..ratelimit import rate_limited_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_MAX_INPUT = 4000
_TIMEOUT_S = 120.0


class ChatConfigOut(BaseModel):
    enabled: bool = False


class ChatIn(BaseModel):
    chatInput: str
    sessionId: str = "web"


class ChatOut(BaseModel):
    answer: str


@router.get("/chat/config", response_model=ChatConfigOut)
async def chat_config(
    _client_id: str = Depends(require_client),
    store: JobStore = Depends(get_store),
):
    """Alleen de toggle (of de chatbot aanstaat) — geen webhook/secret."""
    return ChatConfigOut(enabled=await app_settings.chat_enabled(store))


@router.post("/chat", response_model=ChatOut)
async def chat(
    body: ChatIn,
    _client_id: str = Depends(rate_limited_client),
    store: JobStore = Depends(get_store),
):
    """Stuur een vraag naar de kennisgraaf-agent en geef het antwoord terug."""
    enabled, url, secret = await app_settings.chat_config(store)
    if not enabled or not url:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "De kennisgraaf-assistent staat uit.")
    vraag = (body.chatInput or "").strip()
    if not vraag:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lege vraag.")

    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Chat-Secret"] = secret
    payload = {
        "action": "sendMessage",
        "sessionId": body.sessionId or "web",
        "chatInput": vraag[:_MAX_INPUT],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(_TIMEOUT_S)) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("Chat-webhook onbereikbaar: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "De assistent is onbereikbaar.") from exc
    if resp.status_code >= 400:
        logger.warning("Chat-webhook gaf status %s", resp.status_code)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "De assistent gaf een fout.")

    # De n8n Chat Trigger antwoordt met { output: "…" }; defensief ook text/answer/plat afvangen.
    answer = ""
    try:
        data = resp.json()
        if isinstance(data, dict):
            answer = data.get("output") or data.get("text") or data.get("answer") or ""
        elif isinstance(data, str):
            answer = data
    except ValueError:
        answer = resp.text
    return ChatOut(answer=str(answer or "").strip())
