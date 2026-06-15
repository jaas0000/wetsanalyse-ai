"""FastAPI-app: routers, OpenAPI (Swagger op /docs → importeerbaar in Postman), health/ready,
en startup-reconciliatie van onderbroken jobs."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import timezone

from beanie import init_beanie
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from . import __version__
from .config import get_settings
from .deps import get_engine, get_store
from .llm_profile import LlmProfile
from .project import Project
from .routers import admin, catalog, projects
from .wet_catalog import WetCatalogus

logger = logging.getLogger(__name__)


async def _reaper_loop(interval_s: int) -> None:
    """Periodieke reaper: ruimt runt-jobs met een verlopen lease op (worker weg/gecrasht).
    Mag de app nooit killen — fouten worden gelogd, niet doorgegooid."""
    while True:
        await asyncio.sleep(interval_s)
        try:
            await get_engine().reap_once()
        except Exception:  # noqa: BLE001
            logger.exception("Reaper-ronde is mislukt")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # Globale LLM-concurrency-rem instellen (kostenbeheersing tegen zelf-veroorzaakte rate-limits).
    from .llm import throttle
    throttle.configure(settings.llm_max_concurrency)
    # tz_aware: pymongo geeft BSON-datetimes anders *naive* terug (UTC-waarde, tzinfo=None),
    # waardoor `.isoformat()` een offset-loze string oplevert die de browser als lokale tijd
    # leest — dat verschuift de "verstreken"-tijd op het dashboard met de tz-offset. Met
    # tz_aware komen alle datetimes als UTC-aware terug en serialiseren ze met `+00:00`.
    motor_client = AsyncIOMotorClient(settings.mongodb_url, tz_aware=True, tzinfo=timezone.utc)
    await init_beanie(
        database=motor_client[settings.mongodb_db],
        document_models=[Project, LlmProfile, WetCatalogus],
    )
    try:
        from . import profiles

        await profiles.ensure_seeded(settings)
    except Exception:  # noqa: BLE001 — seeding mag de start nooit blokkeren
        logger.exception("Seeden van het default-modelprofiel is mislukt")
    try:
        await get_engine().reconcile_startup()
    except Exception:  # noqa: BLE001 — engine mag de start nooit blokkeren
        logger.exception("Startup-reconciliatie van onderbroken jobs is mislukt")
    reaper_task: asyncio.Task | None = None
    if settings.reaper_interval_s > 0:
        reaper_task = asyncio.create_task(_reaper_loop(settings.reaper_interval_s))
    yield
    if reaper_task is not None:
        reaper_task.cancel()
        try:
            await reaper_task
        except asyncio.CancelledError:
            pass
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

# Eén kanonieke resource onder een versie-prefix (/v1/projects). De eerdere losse
# /analyses-router is geconsolideerd; clients migreren naar /v1/projects.
app.include_router(projects.router, prefix="/v1")
app.include_router(catalog.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")


@app.get("/health", tags=["meta"])
async def health():
    """Liveness — geen auth, mag niet falen op trage MCP/LLM."""
    s = get_settings()
    return {"status": "ok", "version": __version__, "git_sha": s.git_sha, "build_time": s.build_time}


@app.get("/ready", tags=["meta"])
async def ready():
    """Readiness — configuratie aanwezig? (geen netwerk-call om health niet te koppelen)."""
    s = get_settings()
    # Alleen booleans — geen interne URL's/hostnamen lekken aan een ongeauthenticeerd endpoint.
    return {
        "auth_geconfigureerd": bool(s.client_tokens) or not s.auth_required,
        "mcp_geconfigureerd": bool(s.mcp_url),
        "llm_model_gezet": bool(s.llm_model),
        "mongodb_geconfigureerd": bool(s.mongodb_url),
    }
