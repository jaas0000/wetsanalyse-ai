"""Shared test configuration — set required env vars before any app imports."""

import os
import tempfile
from pathlib import Path
from cryptography.fernet import Fernet

# These MUST be set before importing app modules because
# app.config._validate_config() runs at import time.
os.environ.setdefault("WETSANALYSE_SECRET_KEY", "test-secret-key-for-pytest")
os.environ.setdefault("FERNET_KEY", Fernet.generate_key().decode())

import pytest


@pytest.fixture(autouse=True)
def _test_db(tmp_path):
    """Use a temp SQLite file for every test so connections share the same DB."""
    db_file = tmp_path / "test.db"
    os.environ["WETSANALYSE_DATABASE_PATH"] = str(db_file)

    # Re-initialise the DB schema
    from app.auth import init_db

    init_db()
    yield

    # Cleanup
    os.environ.pop("WETSANALYSE_DATABASE_PATH", None)
