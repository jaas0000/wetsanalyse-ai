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
import secrets
import time
from collections import deque
from collections.abc import AsyncIterator

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sse_starlette.sse import EventSourceResponse

load_dotenv()  # laad .env als die naast de server staat

from agent import observability  # noqa: E402
from agent.agent import answer_stream  # noqa: E402
from agent.config import Settings  # noqa: E402
from agent.models import ChatRequest  # noqa: E402

settings = Settings.from_env()
observability.setup(settings)  # logging + gated OTel, vóór de app draait

app = FastAPI(title="Graph QA Agent", version="0.2.0")
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
    async def event_generator() -> AsyncIterator[dict]:
        async for event in answer_stream(request.question, request.conversation_id):
            yield {"data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


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
