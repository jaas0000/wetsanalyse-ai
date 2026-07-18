"""
FastAPI-backend voor de graph-qa agent.

Endpoint: POST /v1/chat
  - Request: {"question": "..."}
  - Response: SSE-stream van JSON-events
    {"type": "token", "content": "..."}
    {"type": "sources", "sources": [...]}
    {"type": "grounding", "grounded": bool, "unsupported": [...]}
    {"type": "done"}
    {"type": "error", "message": "..."}

Authenticatie: optionele Bearer-token via env QA_API_TOKEN (timing-safe vergeleken).
Als QA_API_TOKEN niet gezet is, is het endpoint open (voor lokale dev).

Beveiliging: CORS staat credentials alleen toe bij een expliciete origin-lijst
(nooit samen met "*"); een lichte per-IP rate-limit (per proces) als dependency
(bewust géén BaseHTTPMiddleware, zodat de SSE-stream niet gebufferd wordt).

Observability: gestructureerde JSON-logs + gated OpenTelemetry (agent/observability.py),
zodat graph-qa in de frontend→API→MCP-trace valt.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

load_dotenv()  # laad .env als die naast de server staat

from agent import observability  # noqa: E402
from agent.agent import answer_stream  # noqa: E402
from agent.config import Settings  # noqa: E402
from agent.models import ChatRequest  # noqa: E402

logger = logging.getLogger("graph_qa.chat")

settings = Settings.from_env()
observability.setup(settings)  # logging + gated OTel, vóór de app draait

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Fail-fast bij boot: GRAPHDB_TOKEN is niet-optioneel. Zonder token zou graph-qa anders
    # 'gezond' opstarten en pas per chatvraag falen — én tegen de open+writable graaf mag er
    # nooit tokenloos verkeer lopen. Ontbreekt de token, dan weigert de service te starten
    # (uvicorn stopt → container ongezond/herstart-loop, i.p.v. stil kapot). De per-request
    # require_graph() blijft als tweede net bestaan.
    settings.require_graph()
    yield


app = FastAPI(title="Graph QA Agent", version="0.2.0", lifespan=_lifespan)
app.add_middleware(observability.RequestContextMiddleware)
observability.instrument_fastapi(app)

# CORS met credentials mag niet samen met "*" (browsers weigeren die combinatie én
# het is te ruim). Alleen credentials toestaan bij een expliciete origin-lijst.
_wildcard = settings.cors_origins == ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=not _wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bearer = HTTPBearer(auto_error=False)

# Per-IP sliding-window rate-limit (per proces).
_hits: dict[str, deque[float]] = {}


def _rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "onbekend"
    now = time.monotonic()
    window = settings.rate_window_seconds
    bucket = _hits.setdefault(ip, deque())
    while bucket and bucket[0] <= now - window:
        bucket.popleft()
    if len(bucket) >= settings.rate_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Te veel verzoeken, probeer het zo weer.",
        )
    bucket.append(now)


def _check_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = settings.qa_api_token
    if not expected:
        return  # geen token geconfigureerd → open
    provided = creds.credentials if creds else ""
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ongeldig of ontbrekend token",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/chat")
async def chat(
    request: ChatRequest,
    _rl: None = Depends(_rate_limit),
    _auth: None = Depends(_check_auth),
) -> EventSourceResponse:
    logger.info(
        "chat ontvangen",
        extra={
            "categorie": "functioneel",
            "chat_session_id": request.conversation_id or "",
            "chat_vraag_lengte": len(request.question or ""),
        },
    )

    async def event_generator() -> AsyncIterator[dict]:
        async for event in answer_stream(request.question, request.conversation_id):
            yield {"data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


# ---- chat-webhook: de kennisgraaf-agent achter de webapp-chatbel --------------------------------
# De Wetsanalyse-API-chatproxy stuurt {action, sessionId, chatInput} (+ optioneel header
# X-Chat-Secret) en verwacht één JSON {output: "..."} terug. Dit endpoint spreekt dat contract,
# draait de agent en mapt sessionId → conversation_id (durabel geheugen). Bewust geen per-IP
# rate-limit: alle webapp-gebruikers komen achter één API-bron-IP binnen. Het secret is optioneel
# (X-Chat-Secret / body.secret) — de service draait intern-only, dus zonder QA_API_TOKEN is 'ie open.

class ChatWebhookIn(BaseModel):
    chatInput: str = Field(max_length=8000)
    sessionId: str = Field("web", max_length=200)
    secret: str | None = None
    action: str | None = None  # genegeerd (compat: de proxy stuurt "sendMessage")


def _check_chat_secret(body_secret: str | None, header_secret: str | None) -> None:
    expected = settings.qa_api_token
    if not expected:
        return  # geen secret geconfigureerd → open (intern-only)
    provided = header_secret or body_secret or ""
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Ongeldig of ontbrekend chat-secret")


@app.post("/v1/chat-webhook")
async def chat_webhook(
    body: ChatWebhookIn,
    x_chat_secret: str | None = Header(default=None, alias="X-Chat-Secret"),
) -> dict[str, str]:
    _check_chat_secret(body.secret, x_chat_secret)
    question = (body.chatInput or "").strip()
    if not question:
        return {"output": ""}

    # AVG: alleen metadata (sessie-id + lengtes + grounded), nooit de vraag/antwoord-inhoud.
    _log = {
        "categorie": "functioneel",
        "chat_session_id": body.sessionId or "web",
        "chat_vraag_lengte": len(question),
    }
    logger.info("chat-webhook ontvangen", extra=_log)

    parts: list[str] = []
    sources: list[dict] = []
    grounded: bool | None = None
    error: str | None = None
    async for event in answer_stream(question, body.sessionId or "web"):
        t = event.get("type")
        if t == "token":
            parts.append(event["content"])
        elif t == "sources":
            sources = event["sources"]
        elif t == "grounding":
            grounded = event.get("grounded")
        elif t == "error":
            error = event["message"]

    answer = "".join(parts).strip()
    if not answer:
        logger.warning("chat-webhook fout", extra={**_log, "chat_fout": error or "geen antwoord"})
        return {"output": f"Er ging iets mis: {error}" if error else "Geen antwoord."}
    logger.info(
        "chat-webhook klaar",
        extra={
            **_log,
            "chat_antwoord_lengte": len(answer),
            "chat_bron_aantal": len(sources),
            "grounded": grounded,
        },
    )
    if sources:
        lijst = "\n".join(
            f"- [{s.get('label') or s.get('uri')}]({s.get('uri')})" for s in sources[:20]
        )
        answer = f"{answer}\n\n**Bronnen:**\n{lijst}"
    return {"output": answer}


def run() -> None:
    import os

    import uvicorn
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
        reload=False,
    )


if __name__ == "__main__":
    run()
