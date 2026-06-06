"""Gedeelde database-hulpfuncties.

Centraliseert _db_path() en _get_db() die voorheen gedupliceerd waren
in app.auth en app.engine.analyse_store.
"""

import sqlite3
from pathlib import Path

from app.config import settings


def db_path() -> Path:
    """Haal het database pad vanuit settings."""
    return Path(settings.database_path)


def get_db() -> sqlite3.Connection:
    """Haal een database-connectie met WAL en foreign keys aangezet."""
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
