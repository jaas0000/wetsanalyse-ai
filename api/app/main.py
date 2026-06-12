"""FastAPI-app: routers, OpenAPI (Swagger op /docs → importeerbaar in Postman), health/ready,
en startup-reconciliatie van onderbroken jobs."""

from __future__ import annotations

from contextlib import asynccontextmanager

from beanie import init_beanie
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from . import __version__
from .config import get_settings
from .deps import get_engine, get_store
from .project import Project
from .routers import analyses, projects


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    motor_client = AsyncIOMotorClient(settings.mongodb_url)
    await init_beanie(database=motor_client[settings.mongodb_db], document_models=[Project])
    try:
        await get_engine().reconcile_startup()
    except Exception:  # noqa: BLE001 — engine mag de start nooit blokkeren
        pass
    yield
    motor_client.close()


app = FastAPI(
    title="Wetsanalyse API",
    version=__version__,
    description="Headless orchestratie van de Wetsanalyse (JAS). Async checkpoints; "
    "rapport.json als primaire bron. Auth via per-client bearer-token.",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyses.router)
app.include_router(projects.router)


@app.get("/health", tags=["meta"])
async def health():
    """Liveness — geen auth, mag niet falen op trage MCP/LLM."""
    s = get_settings()
    return {"status": "ok", "version": __version__, "git_sha": s.git_sha, "build_time": s.build_time}


@app.get("/ready", tags=["meta"])
async def ready():
    """Readiness — configuratie aanwezig? (geen netwerk-call om health niet te koppelen)."""
    s = get_settings()
    return {
        "auth_geconfigureerd": bool(s.client_tokens) or not s.auth_required,
        "mcp_url": s.mcp_url,
        "llm_model_gezet": bool(s.llm_model),
        "mongodb_url": s.mongodb_url,
    }
