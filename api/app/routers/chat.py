"""Client-facing kennisgraaf-chatbot: proxy naar de n8n-agent (GraphDB-kennisgraaf).

De webapp toont een chatbel die via de BFF hierheen praat. De webhook-URL + het secret staan in
de runtime-instellingen (`app_settings`, beheerbaar via /beheer) en blijven dus **server-side**;
de browser krijgt ze nooit te zien. `GET /v1/chat/config` geeft alleen de aan/uit-toggle terug.

`POST /v1/chat` is een **Server-Sent-Events-stream**: de agent kan lang doen (tot minuten), en een
synchrone respons zou tegen de ~60s proxytimeout lopen. Daarom houden we de verbinding open met
`: keep-alive`-heartbeats terwijl de agent werkt en sturen we het volledige antwoord als één
`data:`-event zodra het klaar is. De agent onthoudt de context per `sessionId`; de rate-limit is
per gebruiker (`rate_limited_chat`).
"""

from __future__ import annotations

import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import app_settings
from ..auth import require_client
from ..deps import get_store
from ..jobstore import JobStore
from ..ratelimit import rate_limited_chat

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_MAX_INPUT = 4000
_CONNECT_S = 15.0  # korte connect-timeout als vangnet; de read-fase heeft géén eigen deadline
_HEARTBEAT_S = 15.0
_MAX_WAIT_S = 300.0  # de SSE-lus is de enige autoriteit over de totale wachttijd (~5 min)


class ChatConfigOut(BaseModel):
    enabled: bool = False


class ChatIn(BaseModel):
    # Harde lengtegrens (→ 422) vóór verwerking; `_MAX_INPUT` truncatie blijft als tweede net.
    chatInput: str = Field(max_length=8000)
    sessionId: str = Field("web", max_length=200)


@router.get("/chat/config", response_model=ChatConfigOut)
async def chat_config(
    _client_id: str = Depends(require_client),
    store: JobStore = Depends(get_store),
):
    """Alleen de toggle (of de chatbot aanstaat) — geen webhook/secret."""
    return ChatConfigOut(enabled=await app_settings.chat_enabled(store))


async def _vraag_agent(url: str, secret: str, session_id: str, vraag: str) -> str:
    """Roep de n8n-webhook aan en geef het (defensief geparste) antwoord terug."""
    headers = {"Content-Type": "application/json"}
    payload = {
        "action": "sendMessage",
        "sessionId": session_id or "web",
        "chatInput": vraag[:_MAX_INPUT],
    }
    # Het gedeelde geheim gaat in de BODY mee (de n8n Chat-Trigger geeft request-headers níét door
    # aan downstream-nodes, wél extra body-velden); een gate-node in de workflow checkt het. Ook als
    # header meesturen kan geen kwaad voor eventueel toekomstig gebruik.
    if secret:
        payload["secret"] = secret
        headers["X-Chat-Secret"] = secret
    # De SSE-lus (_MAX_WAIT_S) is de primaire deadline en kapt een écht te trage run af via
    # taak.cancel(). De read-timeout staat er als redundant vangnet net boven (_MAX_WAIT_S + 30),
    # zodat een geslaagd-maar-traag antwoord niet vóórtijdig sneuvelt maar een hangende socket na
    # de SSE-deadline alsnog wordt losgelaten. De connect-timeout blijft kort tegen een onbereikbare host.
    timeout = httpx.Timeout(_MAX_WAIT_S + 30, connect=_CONNECT_S)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        raise RuntimeError(f"webhook status {resp.status_code}")
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
    return str(answer or "").strip()


@router.post("/chat")
async def chat(
    body: ChatIn,
    request: Request,
    _client_id: str = Depends(rate_limited_chat),
    store: JobStore = Depends(get_store),
):
    """Stream het agent-antwoord als SSE (heartbeats tijdens het wachten, dan één `data:`-event)."""
    enabled, url, secret = await app_settings.chat_config(store)
    if not enabled or not url:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "De kennisgraaf-assistent staat uit.")
    vraag = (body.chatInput or "").strip()
    if not vraag:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lege vraag.")

    async def stream():
        taak = asyncio.ensure_future(_vraag_agent(url, secret, body.sessionId, vraag))
        gewacht = 0.0
        while True:
            if await request.is_disconnected():
                taak.cancel()
                return
            done, _pending = await asyncio.wait({taak}, timeout=_HEARTBEAT_S)
            if done:
                break
            gewacht += _HEARTBEAT_S
            if gewacht >= _MAX_WAIT_S:
                taak.cancel()
                yield f"event: error\ndata: {json.dumps({'detail': 'De assistent reageerde niet op tijd.'})}\n\n"
                return
            yield ": keep-alive\n\n"  # houdt de verbinding open (geen idle-timeout)
        try:
            antwoord = taak.result()
            yield f"data: {json.dumps({'answer': antwoord})}\n\n"
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("Chat-fout: %s", exc)
            yield (
                "event: error\ndata: "
                + json.dumps({"detail": "De assistent is onbereikbaar of gaf een fout."})
                + "\n\n"
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
