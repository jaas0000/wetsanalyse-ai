"""Async SQLAlchemy-Core laag: engine-beheer + tabeldefinities.

De datalaag is bewust **Core** (geen ORM): alle SQL is geïsoleerd in de service-modules
(profiles/wetten/users/api_tokens/annotatie_store), de domeinmodellen blijven plain Pydantic. De
types zijn portable — `JSON` wordt `JSONB` op PostgreSQL en gewone `JSON` op SQLite, zodat de
unit-tests op een in-memory SQLite draaien en productie op PostgreSQL (CloudNativePG).

De engine wordt lui geïnitialiseerd (lifespan in productie, fixture in tests) zodat de modules
zonder verbinding importeerbaar blijven.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
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

# NB: de analyse-pijplijn is verwijderd. De bijbehorende tabellen (`projects`, `rondes`, `llm_calls`,
# `app_settings`) worden niet meer gedefinieerd of aangemaakt; op een bestaande productie-DB blijven ze
# verweesd staan (samen met een eventuele Grafana-view erop) — het daadwerkelijk droppen is een
# aparte, bewuste migratie, niet iets dat hier stil bij de start gebeurt.

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

# Login-accounts voor de webapp. De API is de identiteitsbron; de frontend (Auth.js) houdt alleen
# de browsersessie. Inloggen gaat met de `userid` (de natuurlijke sleutel, lowercase genormaliseerd);
# `email` is een verplicht, uniek registratiegegeven (geen inlog-identiteit). Het TOTP-secret staat
# versleuteld (Fernet, zie secrets_crypto) en is optioneel (2FA staat standaard uit).
users = Table(
    "users",
    metadata,
    Column("userid", String(64), primary_key=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("password_hash", Text, nullable=False),
    Column("role", String(16), nullable=False, default="analist"),
    Column("totp_secret_enc", Text, nullable=True),
    Column("totp_enabled", Boolean, nullable=False, default=False),
    Column("active", Boolean, nullable=False, default=True),
    Column("created", _DT, nullable=False),
    Column("updated", _DT, nullable=False),
)

# Genereerbare API-tokens voor programmatische admin-toegang (bv. de admin-MCP), náást de
# statische env-admin-tokens. Alleen de sha256-HASH van het token wordt bewaard (hoog-entropie →
# geen bcrypt nodig); de plaintext wordt één keer bij aanmaken getoond en nergens opgeslagen. Het
# `token_prefix` dient enkel voor herkenning in de UI. Intrekken = `active=False` (geen delete-eis).
api_tokens = Table(
    "api_tokens",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("label", String(128), nullable=False, default=""),
    Column("token_hash", String(64), nullable=False, unique=True),
    Column("token_prefix", String(24), nullable=False, default=""),
    Column("scope", String(16), nullable=False, default="admin"),
    Column("active", Boolean, nullable=False, default=True),
    Column("created_by", String(128), nullable=False, default=""),
    Column("created", _DT, nullable=False),
    Column("last_used", _DT, nullable=True),
)

# --- Annotatie-domein (wetsanalyse-workbench) ---------------------------------
# Eén rij per bron-document; de elementen (met hun review-levenscyclus + beslissingen) staan als
# JSON — het document draagt de HUIDIGE staat.
annotatie_documenten = Table(
    "annotatie_documenten",
    metadata,
    Column("slug", String(255), primary_key=True),
    Column("client_id", String(128), nullable=False, default=""),
    Column("werkgebied", Text, nullable=False, default=""),
    Column("bwbId", String(64), nullable=False, default=""),
    Column("artikel", String(32), nullable=False, default=""),
    Column("lid", String(32), nullable=False, default=""),
    Column("status", String(24), nullable=False, default="in_review"),
    Column("elementen", _JSON, nullable=False, default=list),
    Column("created", _DT, nullable=False),
    Column("updated", _DT, nullable=False),
    Index("ix_annotatie_docs_client_updated", "client_id", "updated"),
)

# Append-only audit trail: de onwijzigbare geschiedenis (event-log) náást de huidige documentstaat.
# Alleen inserts; nooit update/delete. De tijdlijn = ORDER BY id.
annotatie_audit = Table(
    "annotatie_audit",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("document_slug", String(255), nullable=False),
    Column("client_id", String(128), nullable=False, default=""),
    Column("actor", String(128), nullable=False, default=""),
    Column("actie", String(64), nullable=False, default=""),
    Column("element_id", String(64), nullable=True),
    Column("detail", _JSON, nullable=True),
    Column("tijdstip", _DT, nullable=False),
    Index("ix_annotatie_audit_doc_id", "document_slug", "id"),
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
    """Maak de tabellen aan (tests + beproevingsfase; productie kan dit later via Alembic doen).
    Idempotent: alleen ONTBREKENDE tabellen worden aangemaakt. De kept-tabellen dragen hun volledige
    schema in de definities hierboven, dus er is geen aparte kolom-migratiestap meer nodig."""
    async with get_engine().begin() as conn:
        await conn.run_sync(metadata.create_all)


def aware(dt: datetime | None) -> datetime | None:
    """Normaliseer een uit de DB gelezen datetime naar UTC-aware. SQLite geeft naïeve datetimes
    terug (geen tz-opslag); Postgres geeft al aware terug. Zo serialiseert .isoformat() altijd met
    offset en leest de browser de tijd niet als lokale tijd."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
