"""Per-client bearer-tokens — erft het patroon van de MCP (tools/wettenbank-mcp/src/auth.ts).

Constant-tijd-vergelijking, fail-closed start (geen tokens ⇒ alles 401), tokens nooit loggen.
Elke geslaagde auth levert een client_id op die in de audit (job.json) belandt.
"""

from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


def authenticate(authorization: str | None, settings: Settings) -> str:
    """Valideer de Authorization-header. Geeft de client_id terug of werpt 401."""
    if not settings.auth_required:
        return "anonymous"

    if not settings.client_tokens:
        # Fail-closed: auth verplicht maar niets geconfigureerd.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Auth niet geconfigureerd (geen tokens).",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer-token vereist.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    presented = authorization[len("Bearer ") :].strip()
    # Constant-tijd-vergelijking tegen elk bekend token.
    for token, client_id in settings.client_tokens.items():
        if hmac.compare_digest(presented, token):
            return client_id

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Ongeldig token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_client(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """FastAPI-dependency: geeft de client_id of werpt 401."""
    authorization = f"Bearer {credentials.credentials}" if credentials else None
    return authenticate(authorization, get_settings())


def authenticate_admin(authorization: str | None, settings: Settings) -> str:
    """Valideer de Authorization-header tegen de aparte admin-tokens. Geeft de admin-id terug.

    Altijd auth-plichtig (geen `auth_required`-bypass): de admin-laag beheert de LLM-config en
    mag nooit open staan. Fail-closed: geen admin-tokens geconfigureerd ⇒ alles 401.
    """
    if not settings.admin_tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin-auth niet geconfigureerd (geen admin-tokens).",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer-token vereist.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    presented = authorization[len("Bearer ") :].strip()
    for token, admin_id in settings.admin_tokens.items():
        if hmac.compare_digest(presented, token):
            return admin_id
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Ongeldig admin-token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """FastAPI-dependency: geeft de admin-id of werpt 401."""
    authorization = f"Bearer {credentials.credentials}" if credentials else None
    return authenticate_admin(authorization, get_settings())
