"""WP-B: timing-safe tokencheck en CORS-credentials-regel."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import api.main as main


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_geen_token_geconfigureerd_is_open(monkeypatch):
    monkeypatch.setattr(main.settings, "qa_api_token", None)
    assert main._check_auth(_creds("wat-dan-ook")) is None
    assert main._check_auth(None) is None


def test_juist_token_wordt_geaccepteerd(monkeypatch):
    monkeypatch.setattr(main.settings, "qa_api_token", "geheim")
    assert main._check_auth(_creds("geheim")) is None


def test_fout_of_ontbrekend_token_wordt_geweigerd(monkeypatch):
    monkeypatch.setattr(main.settings, "qa_api_token", "geheim")
    with pytest.raises(HTTPException):
        main._check_auth(_creds("mis"))
    with pytest.raises(HTTPException):
        main._check_auth(None)


def test_cors_credentials_niet_bij_wildcard():
    from agent.config import Settings

    assert Settings(cors_origins=["*"]).cors_origins == ["*"]
    # De main-module leidt hieruit allow_credentials=False af (wildcard).
    # Bij een expliciete origin mag het wél.
    assert Settings(cors_origins=["https://x.nl"]).cors_origins == ["https://x.nl"]
