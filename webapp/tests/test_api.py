"""Unit tests for the user API endpoints — register, login, me."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import init_db

client = TestClient(app)


# ── helpers ─────────────────────────────────────────────────────────────────

def _register(username: str = "testuser1", password: str = "testpass1234"):
    """Register a user via the API and return the response."""
    return client.post("/api/user/register", json={"username": username, "password": password})


def _login(username: str = "testuser1", password: str = "testpass1234"):
    """Log in via the API and return the response."""
    return client.post("/api/user/login", json={"username": username, "password": password})


# ── /api/user/register ──────────────────────────────────────────────────────

def test_register_endpoint():
    """POST /api/user/register with username+password returns 200."""
    resp = _register()
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "testuser1"
    assert "message" in data


# ── /api/user/login ─────────────────────────────────────────────────────────

def test_login_endpoint():
    """Register then login; response includes username, has_api_key, provider, endpoint, model."""
    _register("loginuser1", "loginpass1234")
    resp = _login("loginuser1", "loginpass1234")
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "loginuser1"
    assert "has_api_key" in data
    assert "provider" in data
    assert "endpoint" in data
    assert "model" in data


def test_login_wrong_password():
    """Register then login with wrong password returns 401."""
    _register("badpwuser1", "correctpass1")
    resp = _login("badpwuser1", "wrongpass1234")
    assert resp.status_code == 401


# ── /api/user/me ────────────────────────────────────────────────────────────

def test_me_authenticated():
    """Register, login (get cookie), GET /api/user/me returns user info."""
    _register("meuser1", "mepass12345")
    login_resp = _login("meuser1", "mepass12345")
    assert login_resp.status_code == 200

    # The TestClient persists cookies across requests
    me_resp = client.get("/api/user/me")
    assert me_resp.status_code == 200
    data = me_resp.json()
    assert data["username"] == "meuser1"
    assert "has_api_key" in data
    assert "provider" in data


def test_me_unauthenticated():
    """GET /api/user/me without a cookie returns 401."""
    # Use a fresh client with no cookies
    fresh_client = TestClient(app)
    resp = fresh_client.get("/api/user/me")
    assert resp.status_code == 401
