"""FastAPI-app: routers, OpenAPI (Swagger op /docs → importeerbaar in Postman), health/ready,
en startup-reconciliatie van onderbroken jobs."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .config import get_settings
from .deps import get_store
from .routers import analyses


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: markeer jobs die in een runt-state hingen als onderbroken (geen lopende taak meer).
    try:
        from .contracts import FoutKlasse, JobFout, JobState

        store = get_store()
        for job in store.list_jobs():
            if job.state in (JobState.act2_runt, JobState.act3_runt, JobState.bouwt):
                job.state = JobState.fout
                job.error = JobFout(
                    stap=job.current_activiteit or "?",
                    ronde=job.current_ronde or None,
                    klasse=FoutKlasse.intern,
                    bericht="Onderbroken bij herstart van de dienst (gebruik /retry).",
                )
                store.save_job(job)
    except Exception:  # noqa: BLE001 — reconciliatie mag de start nooit blokkeren
        pass
    yield


app = FastAPI(
    title="Wetsanalyse API",
    version=__version__,
    description="Headless orchestratie van de Wetsanalyse (JAS). Async checkpoints; "
    "rapport.json als primaire bron. Auth via per-client bearer-token.",
    lifespan=lifespan,
)
app.include_router(analyses.router)


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
        "analyses_dir": str(s.analyses_dir),
    }
