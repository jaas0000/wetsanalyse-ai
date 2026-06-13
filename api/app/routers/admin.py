"""Admin-resource (gemount onder /v1/admin) — LLM-modelprofielen beheren + token-verbruik.

Alles achter `require_admin` (aparte admin-bearer, fail-closed). De plaintext-API-key komt
NOOIT terug in een respons: clients zien alleen `api_key_set`. Het schrijven van een key
vereist een geconfigureerde master key (LLM_CONFIG_SECRET); ontbreekt die → 400.

PUT    /v1/admin/profiles/{name}          — maak/werk profiel bij (api_key write-only)
GET    /v1/admin/profiles                 — lijst (incl. verbruik per profiel)
GET    /v1/admin/profiles/{name}          — één profiel
DELETE /v1/admin/profiles/{name}          — verwijder (niet de default)
POST   /v1/admin/profiles/{name}/default  — markeer als default
POST   /v1/admin/profiles/{name}/test     — test de verbinding (kleine LLM-call)
GET    /v1/admin/usage                    — token-verbruik (aggregatie over provenance)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from .. import profiles, usage
from ..auth import require_admin
from ..llm.litellm_client import build_llm_client
from ..llm_profile import LlmProfile
from ..secrets_crypto import SecretsCryptoError, crypto_beschikbaar

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# --- modellen ------------------------------------------------------------------

class ProfileIn(BaseModel):
    provider: str | None = Field(default=None, max_length=64)
    model: str | None = Field(default=None, max_length=128)
    api_base: str | None = Field(default=None, max_length=512)
    api_version: str | None = Field(default=None, max_length=64)
    output_strategy: str | None = Field(default=None, max_length=32)
    temperature: float | None = None
    # Write-only: leeg/weggelaten = bestaande key ongewijzigd laten.
    api_key: str | None = Field(default=None, max_length=512)
    is_default: bool | None = None


class ProfileOut(BaseModel):
    name: str
    provider: str
    model: str
    api_base: str
    api_version: str | None = None
    output_strategy: str
    temperature: float
    is_default: bool
    api_key_set: bool
    updated_by: str = ""
    updated: str = ""
    verbruik: dict | None = None


class TestResult(BaseModel):
    ok: bool
    model: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    detail: str = ""


def _to_out(p: LlmProfile, verbruik: dict | None = None) -> ProfileOut:
    return ProfileOut(
        name=p.name,
        provider=p.provider,
        model=p.model,
        api_base=p.api_base,
        api_version=p.api_version,
        output_strategy=p.output_strategy,
        temperature=p.temperature,
        is_default=p.is_default,
        api_key_set=bool(p.enc_api_key),
        updated_by=p.updated_by,
        updated=p.updated.isoformat(),
        verbruik=verbruik,
    )


# --- profielen -----------------------------------------------------------------

@router.get("/profiles", response_model=list[ProfileOut])
async def lijst_profielen():
    items = await profiles.list_profiles()
    verbruik = await usage.usage_per_profiel()
    return [_to_out(p, verbruik.get(p.name)) for p in items]


@router.get("/profiles/{name}", response_model=ProfileOut)
async def haal_profiel(name: str):
    p = await profiles.get_profile(name)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Onbekend profiel: {name}")
    return _to_out(p)


@router.put("/profiles/{name}", response_model=ProfileOut)
async def upsert_profiel(name: str, body: ProfileIn, admin_id: str = Depends(require_admin)):
    if body.api_key and not crypto_beschikbaar():
        raise HTTPException(
            status_code=400,
            detail="Geen LLM_CONFIG_SECRET geconfigureerd; een API-key kan niet versleuteld worden opgeslagen.",
        )
    try:
        p = await profiles.upsert_profile(
            name,
            updated_by=admin_id,
            provider=body.provider,
            model=body.model,
            api_base=body.api_base,
            api_version=body.api_version,
            output_strategy=body.output_strategy,
            temperature=body.temperature,
            api_key=body.api_key,
            is_default=body.is_default,
        )
    except SecretsCryptoError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_out(p)


@router.delete("/profiles/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def verwijder_profiel(name: str):
    try:
        await profiles.delete_profile(name)
    except profiles.ProfileError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/profiles/{name}/default", response_model=ProfileOut)
async def maak_default(name: str):
    try:
        p = await profiles.set_default(name)
    except profiles.ProfileError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _to_out(p)


@router.post("/profiles/{name}/test", response_model=TestResult)
async def test_profiel(name: str):
    if await profiles.get_profile(name) is None:
        raise HTTPException(status_code=404, detail=f"Onbekend profiel: {name}")
    cfg = None
    try:
        cfg = await profiles.resolve_config(name)
        client = build_llm_client(cfg)
        res = await client.complete(
            system="Je bent een verbindingstest. Antwoord uitsluitend met geldige JSON.",
            user='Geef exact: {"ok": true}',
            schema={"type": "object", "properties": {"ok": {"type": "boolean"}}},
        )
    except SecretsCryptoError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 — toon de fout, lek geen secrets
        return TestResult(ok=False, model=cfg.model if cfg else "", detail=f"{type(e).__name__}: {e}")
    return TestResult(ok=True, model=res.model, tokens_in=res.tokens_in, tokens_out=res.tokens_out)


# --- verbruik ------------------------------------------------------------------

@router.get("/usage")
async def token_verbruik(
    group_by: str = Query("model"),
    van: str | None = Query(None),
    tot: str | None = Query(None),
):
    try:
        return await usage.usage_report(group_by=group_by, van=van, tot=tot)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
