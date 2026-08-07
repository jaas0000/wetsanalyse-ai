"""
FastAPI-backend voor de graph-qa agent.

Endpoint: POST /v1/chat
  - Request: {"question": "..."}
  - Response: SSE-stream van JSON-events
    {"type": "status", "message": "..."}     # stap-labels (specialist/tools/deelvraag)
    {"type": "reason", "content": "..."}     # denkproces-narratie (live), gescheiden van het antwoord
    {"type": "token", "content": "..."}      # het eindantwoord
    {"type": "sources", "sources": [...]}
    {"type": "grounding", "grounded": bool, "unsupported": [...]}
    {"type": "done"}
    {"type": "error", "message": "..."}
    (annotatie-route emit daarnaast {"type":"doel",...}, {"type":"element",...} — het element draagt
     een Critic-`aandacht` (groen|geel|rood) + `critic`-motivatie — en één {"type":"ontbrekend","items":[...]})

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
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sse_starlette.sse import EventSourceResponse

load_dotenv()  # laad .env als die naast de server staat

from agent import observability  # noqa: E402
from agent.agent import answer_stream, delete_conversation  # noqa: E402
from agent.agent_common import run_sync  # noqa: E402
from agent.config import Settings  # noqa: E402
from agent.models import ArtikelResult, ChatRequest  # noqa: E402

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
    # App-shutdown: OTel-buffers flushen zodat de laatste spans/metrics niet verloren gaan.
    observability.shutdown()


app = FastAPI(title="Graph QA Agent", version="0.2.0", lifespan=_lifespan)
app.add_middleware(observability.RequestContextMiddleware)
observability.instrument_fastapi(app)

# CORS met credentials mag niet samen met "*" (browsers weigeren die combinatie én
# het is te ruim). Alleen credentials toestaan bij een expliciete origin-lijst.
def _has_wildcard_origin(origins: list[str]) -> bool:
    """True zodra "*" ergens in de origin-lijst staat — óók naast expliciete origins. Starlette
    reflecteert dan élke origin, dus credentials mogen dan niet aan (anders is de guard te omzeilen)."""
    return any(o == "*" for o in origins)


_wildcard = _has_wildcard_origin(settings.cors_origins)
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
_MAX_TRACKED_IPS = 10_000  # bovengrens; boven deze grens vervallen buckets opruimen (geen geheugenlek)


def _client_ip(request: Request) -> str:
    # Achter een reverse proxy is request.client.host het proxy-IP → één globale bucket. Met
    # trust_proxy nemen we de eerste X-Forwarded-For-hop (de echte client). Standaard uit, zodat een
    # gespooft header de limiet niet omzeilt.
    if settings.trust_proxy:
        xff = request.headers.get("x-forwarded-for", "")
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "onbekend"


def _prune_hits(now: float, window: float) -> None:
    # Voorkom onbegrensde groei van _hits: gooi buckets weg waarvan de laatste hit buiten het venster
    # ligt (volledig verlopen). Alleen als de dict te groot wordt, zodat het pad normaal goedkoop blijft.
    if len(_hits) <= _MAX_TRACKED_IPS:
        return
    verlopen = [k for k, b in _hits.items() if not b or b[-1] <= now - window]
    for k in verlopen:
        _hits.pop(k, None)


def _rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    window = settings.rate_window_seconds
    _prune_hits(now, window)
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


@app.delete("/v1/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def verwijder_conversation(
    conversation_id: str,
    _rl: None = Depends(_rate_limit),
    _auth: None = Depends(_check_auth),
) -> None:
    """Wis het agent-geheugen (checkpointer-thread) van één gesprek. Idempotent (onbekende id → 204).
    De werkplek roept dit aan náást de API-berichten-delete, zodat een verwijderd gesprek niet in de
    checkpointer-DB achterblijft (privacy)."""
    await delete_conversation(conversation_id, settings=settings)


@app.get("/v1/artikel", response_model=ArtikelResult)
async def artikel(
    bwb_id: str,
    artikel: str,
    lid: str | None = None,
    _rl: None = Depends(_rate_limit),
    _auth: None = Depends(_check_auth),
) -> ArtikelResult:
    """Artikeltekst uit de graaf voor het workbench-documentpaneel (weergave == annotatie-corpus).
    Met `lid` beperk je de tekst tot dat ene lid."""
    from agent.adapters.graphdb_graph import make_graph
    from agent.artikel import haal_artikel_sync

    graph = make_graph(settings)
    try:
        await run_sync(graph.initialize)
        data = await run_sync(haal_artikel_sync, bwb_id, artikel, graph, lid)
    finally:
        graph.close()
    return ArtikelResult.model_validate(data)


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
