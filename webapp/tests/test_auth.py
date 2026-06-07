"""Unit tests for app/auth.py — register, authenticate, sessions, fernet."""

import os
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet

from app.auth import (
    authenticate,
    create_user,
    get_user,
    sign_session_token,
    verify_session_token,
    _get_fernet,
)
from app.db import get_db


# ── register ────────────────────────────────────────────────────────────────

def test_register_success():
    """Register a new user and verify it exists in the DB."""
    user = create_user("alice", "secret1234")
    assert user.username == "alice"

    # Verify directly in the DB
    conn = get_db()
    row = conn.execute("SELECT username FROM users WHERE username = ?", ("alice",)).fetchone()
    conn.close()
    assert row is not None
    assert row["username"] == "alice"


def test_register_duplicate():
    """Registering the same username twice should raise HTTPException(409)."""
    from fastapi import HTTPException

    create_user("bob", "secret1234")
    with pytest.raises(HTTPException) as exc_info:
        create_user("bob", "other-pass1")
    assert exc_info.value.status_code == 409


# ── authenticate ────────────────────────────────────────────────────────────

def test_authenticate_success():
    """Authenticate with correct password returns a User."""
    create_user("charlie", "correctpwd1")
    user = authenticate("charlie", "correctpwd1")
    assert user is not None
    assert user.username == "charlie"


def test_authenticate_wrong_password():
    """Authenticate with wrong password returns None."""
    create_user("dave", "correctpwd1")
    result = authenticate("dave", "wrongpass1")
    assert result is None


def test_authenticate_nonexistent():
    """Authenticate with a non-existent user returns None."""
    result = authenticate("ghost_user", "any-pass123")
    assert result is None


# ── sessions ────────────────────────────────────────────────────────────────

def test_session_create_and_verify():
    """Create a session token and verify it returns the correct username."""
    token = sign_session_token("eve", "abc123")
    username = verify_session_token(token)
    assert username == "eve"


def test_session_invalid_token():
    """Verify an invalid / tampered token returns None."""
    # Completely bogus token
    assert verify_session_token("garbage-token") is None

    # Tamper with a real token
    token = sign_session_token("frank", "def456")
    tampered = token[:-5] + "XXXXX"
    assert verify_session_token(tampered) is None


# ── fernet ──────────────────────────────────────────────────────────────────

def test_fernet_invalid_key():
    """Setting FERNET_KEY to an invalid value should raise RuntimeError."""
    original = os.environ.get("FERNET_KEY")
    os.environ["FERNET_KEY"] = "not-a-valid-fernet-key"
    try:
        with pytest.raises(RuntimeError):
            _get_fernet()
    finally:
        # Restore
        if original is not None:
            os.environ["FERNET_KEY"] = original
        else:
            os.environ.pop("FERNET_KEY", None)
