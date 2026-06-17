"""Async SQLAlchemy-Core laag: engine-beheer + tabeldefinities.

De datalaag is bewust **Core** (geen ORM): alle SQL is geïsoleerd in de store en de service-
modules (profiles/wetten/usage), de domeinmodellen blijven plain Pydantic. De types zijn
portable — `JSON` wordt `JSONB` op PostgreSQL en gewone `JSON` op SQLite, zodat de unit-tests
op een in-memory SQLite draaien en productie op PostgreSQL (CloudNativePG).

De engine wordt lui geïnitialiseerd (lifespan in productie, fixture in tests) zodat de store
zonder verbinding importeerbaar blijft.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    Text,
    inspect,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import StaticPool

# JSONB op Postgres (indexeerbaar, efficiënt), gewone JSON op SQLite (tests).
_JSON = JSON().with_variant(JSONB(), "postgresql")
# Tijdzone-bewust opslaan; op Postgres = timestamptz. SQLite kent geen tz → normaliseer bij lezen
# (zie aware()), zodat .isoformat() altijd een offset (UTC) draagt.
_DT = DateTime(timezone=True)

metadata = MetaData()

# Eén rij per analyse-project: state-machine-velden (typed) + JSON voor de samengestelde velden.
# rondes/feedback staan in een aparte tabel (ronde-immutabiliteit, gerichte writes); het
# eindrapport zit als JSON-kolom op het project.
projects = Table(
    "projects",
    metadata,
    Column("slug", String(255), primary_key=True),
    Column("naam", Text, nullable=False, default=""),
    Column("omschrijving", Text, nullable=False, default=""),
    # Het werkgebied bevat meerdere bronnen: list[{bwbId, artikel, lid}] als JSON.
    Column("bronnen", _JSON, nullable=False, default=list),
    Column("analysefocus", Text, nullable=False, default=""),
    Column("review", Boolean, nullable=False, default=True),
    Column("model_profile", String(128), nullable=False, default=""),
    Column("client_id", String(128), nullable=False, default=""),
    Column("state", String(32), nullable=False),
    Column("current_activiteit", String(2), nullable=True),
    Column("current_ronde", Integer, nullable=False, default=0),
    Column("current_fase", String(64), nullable=True),
    Column("current_fase_sinds", _DT, nullable=True),
    Column("waarschuwingen", _JSON, nullable=False, default=list),
    Column("error", _JSON, nullable=True),
    Column("provenance", _JSON, nullable=False, default=list),
    # Concurrency-claim: alleen door claim()/verleng_lease() beheerd (nooit via save_job).
    Column("owner", String(128), nullable=True),
    Column("lease_until", _DT, nullable=True),
    Column("created", _DT, nullable=False),
    Column("updated", _DT, nullable=False),
    Column("rapport", _JSON, nullable=True),
)

# Immutabele analyse-ronde per (project, activiteit, ronde) + de bijbehorende review-feedback.
rondes = Table(
    "rondes",
    metadata,
    Column("project_slug", String(255), nullable=False),
    Column("activiteit", String(2), nullable=False),
    Column("ronde", Integer, nullable=False),
    Column("analyse", _JSON, nullable=False, default=dict),
    Column("feedback", _JSON, nullable=True),
    PrimaryKeyConstraint("project_slug", "activiteit", "ronde"),
)

llm_profiles = Table(
    "llm_profiles",
    metadata,
    Column("name", String(128), primary_key=True),
    Column("provider", String(64), nullable=False, default="azure_ai"),
    Column("model", String(128), nullable=False, default=""),
    Column("api_base", String(512), nullable=False, default=""),
    Column("api_version", String(64), nullable=True),
    Column("output_strategy", String(64), nullable=False, default="prompt_and_parse"),
    Column("temperature", Float, nullable=False, default=0.0),
    Column("enc_api_key", Text, nullable=True),
    Column("is_default", Boolean, nullable=False, default=False),
    Column("updated_by", String(128), nullable=False, default=""),
    Column("created", _DT, nullable=False),
    Column("updated", _DT, nullable=False),
)

wet_catalogus = Table(
    "wet_catalogus",
    metadata,
    Column("bwbId", String(64), primary_key=True),
    Column("naam", Text, nullable=False, default=""),
    Column("updated_by", String(128), nullable=False, default=""),
    Column("created", _DT, nullable=False),
    Column("updated", _DT, nullable=False),
)


# --- engine-beheer -------------------------------------------------------------

_engine: AsyncEngine | None = None


def init_engine(url: str, **kwargs) -> AsyncEngine:
    """(Her)initialiseer de globale async engine. Een in-memory SQLite-URL krijgt automatisch een
    StaticPool zodat alle verbindingen dezelfde database delen (anders is elke connectie leeg)."""
    global _engine
    # Normaliseer een kale Postgres-URL naar de async-driver. Zo is de connection-string die de
    # CloudNativePG-operator genereert (`postgresql://…`) rechtstreeks bruikbaar als DATABASE_URL.
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    is_sqlite_mem = url.startswith("sqlite") and (":memory:" in url or url.endswith("://"))
    if is_sqlite_mem:
        kwargs.setdefault("poolclass", StaticPool)
        kwargs.setdefault("connect_args", {"check_same_thread": False})
    elif not url.startswith("sqlite"):
        kwargs.setdefault("pool_pre_ping", True)
    _engine = create_async_engine(url, **kwargs)
    return _engine


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("DB-engine niet geïnitialiseerd (roep db.init_engine aan in de lifespan).")
    return _engine


async def dispose_engine() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


async def create_all() -> None:
    """Maak de tabellen aan (tests + beproevingsfase; productie kan dit later via Alembic doen)."""
    async with get_engine().begin() as conn:
        await conn.run_sync(metadata.create_all)


async def reconcile_schema() -> None:
    """Idempotente schema-bijwerking voor de werkgebied/bronnen-overgang.

    `create_all` maakt alleen ONTBREKENDE tabellen; het migreert geen kolommen van een
    bestaande tabel. De `projects`-tabel ging van scalar `bwbId/artikel/lid` naar één
    `bronnen` JSON-kolom. Bij een bestaande tabel (zonder Alembic) brengen we het schema hier
    in lijn: voeg `bronnen` toe en laat de legacy-kolommen vallen. Veilig, want er is geen
    data om te bewaren; op een verse DB (kolom al aanwezig) is dit een no-op."""
    engine = get_engine()

    def _kolommen(sync_conn):
        insp = inspect(sync_conn)
        if not insp.has_table("projects"):
            return None
        return {c["name"] for c in insp.get_columns("projects")}

    async with engine.begin() as conn:
        bestaande = await conn.run_sync(_kolommen)
        if bestaande is None:
            return  # tabel bestaat (nog) niet; create_all maakt 'm met het juiste schema
        is_pg = engine.url.get_backend_name() == "postgresql"
        if "bronnen" not in bestaande:
            typ = "JSONB" if is_pg else "JSON"
            default = "'[]'::jsonb" if is_pg else "'[]'"
            await conn.exec_driver_sql(
                f"ALTER TABLE projects ADD COLUMN bronnen {typ} NOT NULL DEFAULT {default}"
            )
        # Legacy scalar-kolommen opruimen (case-sensitief → quoten).
        for legacy in ("bwbId", "artikel", "lid"):
            if legacy in bestaande:
                await conn.exec_driver_sql(f'ALTER TABLE projects DROP COLUMN "{legacy}"')


def aware(dt: datetime | None) -> datetime | None:
    """Normaliseer een uit de DB gelezen datetime naar UTC-aware. SQLite geeft naïeve datetimes
    terug (geen tz-opslag); Postgres geeft al aware terug. Zo serialiseert .isoformat() altijd met
    offset en leest de browser de tijd niet als lokale tijd."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
