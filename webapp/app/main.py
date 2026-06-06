"""Wetsanalyse Webapp — FastAPI applicatie.

Dit is de entry point van de webapp. Het huidige project
(wetsanalyse-ai) blijft intact — deze webapp staat naast het
bestaande project als een losse subfolder.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import FileResponse, JSONResponse

from app.config import settings, _validate_config
from app.auth import init_db
from app.engine.bwb_client import close_client, get_client
from app.engine.analyse_store import ensure_tables
from app.api.analyse import router as analyse_router
from app.api.user import router as user_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_validate_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup en shutdown handlers."""
    # Startup
    logger.info("Wetsanalyse Webapp start op...")
    init_db()
    ensure_tables()
    try:
        await get_client()
    except Exception as e:
        logger.warning("MCP-server niet beschikbaar: %s", e)
    yield
    # Shutdown
    logger.info("Wetsanalyse Webapp stopt...")
    await close_client()


app = FastAPI(
    title="Wetsanalyse Webapp",
    description="Wetsanalyse volgens de methode Ausems, Bulles & Lokin (activiteit 2 + 3)",
    version="1.0.0",
    lifespan=lifespan,
)


# Custom exception handler voor 500 errors — geen interne details lekken
@app.exception_handler(Exception)
async def debug_exception_handler(request, exc):
    import traceback
    logger.error("=== UNCAUGHT EXCEPTION ===")
    logger.error("Type: %s", type(exc).__name__)
    logger.error("Message: %s", exc)
    logger.error("Traceback:\n%s", traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Er is een interne serverfout opgetreden."},
    )


# Routers
app.include_router(analyse_router)
app.include_router(user_router)

# Static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Templates
templates = Jinja2Templates(directory="app/templates")


@app.get("/")
async def index():
    """Serveer de hoofdpagina."""
    return FileResponse("app/templates/index.html")


@app.get("/instellingen")
async def instellingen():
    """Serveer de instellingenpagina."""
    return FileResponse("app/templates/instellingen.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
