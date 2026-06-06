"""API routes voor gebruikersbeheer."""

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth import (
    User,
    authenticate,
    create_user,
    get_current_user,
    sign_session_token,
    update_api_key,
)
from app.models import ApiKeyUpdate, UserCreate, UserLogin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/user", tags=["user"])


@router.post("/register")
async def register(req: UserCreate):
    """Registreer een nieuwe gebruiker."""
    user = create_user(req.username, req.password)
    return {"username": user.username, "message": "Account aangemaakt"}


@router.post("/login")
async def login(req: UserLogin, request: Request, response: Response):
    """Log in en ontvang een sessie-token."""
    user = authenticate(req.username, req.password)
    if user is None:
        raise HTTPException(401, "Ongeldige inloggegevens")

    # Genereer sessie-token (HMAC-signed)
    random_hex = secrets.token_hex(16)
    token = sign_session_token(user.username, random_hex)
    # secure=True alleen over HTTPS; lokaal (HTTP) moet False zijn
    is_secure = request.url.scheme == "https"
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=is_secure,
        max_age=86400 * 7,  # 7 dagen
        samesite="lax",
    )

    return {
        "username": user.username,
        "message": "Ingelogd",
        "has_api_key": user.has_api_key,
        "provider": user.provider,
        "endpoint": user.endpoint,
        "model": user.model,
    }


@router.post("/logout")
async def logout(response: Response):
    """Log uit."""
    response.delete_cookie("session_token")
    return {"message": "Uitgelogd"}


@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    """Haal huidige gebruikersinformatie op."""
    return {
        "username": current_user.username,
        "has_api_key": current_user.has_api_key,
        "provider": current_user.provider,
        "endpoint": current_user.endpoint,
        "model": current_user.model,
    }


@router.post("/apikey")
async def set_api_key(
    req: ApiKeyUpdate,
    current_user: User = Depends(get_current_user),
):
    """Sla API-key op (Azure of OpenRouter)."""
    update_api_key(
        username=current_user.username,
        provider=req.provider,
        endpoint=req.endpoint,
        api_key=req.api_key,
        model=req.model,
    )
    return {"message": "API-key opgeslagen"}
