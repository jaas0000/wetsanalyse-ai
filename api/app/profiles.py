"""Service-laag over de LLM-modelprofielen in MongoDB.

Verantwoordelijkheden:
  - CRUD + default-beheer voor `LlmProfile` (gebruikt door de admin-router).
  - `resolve_config`: zet een profielnaam om in een `LlmConfig` (ontsleutelt de API-key en valt
    voor lege velden terug op de env-config), die de engine aan de LLM-adapter geeft.
  - `ensure_seeded`: seedt bij de allereerste start één default-profiel uit de env-waarden,
    zodat bestaande deploys zonder ingreep blijven werken.

De plaintext-API-key blijft binnen deze laag (en de adapter); admin-responses tonen 'm nooit.
"""

from __future__ import annotations

from .config import Settings, get_settings
from .llm.base import LlmConfig
from .llm_profile import LlmProfile
from .secrets_crypto import decrypt, encrypt


class ProfileError(ValueError):
    """Ongeldige profiel-operatie (onbekend profiel, laatste/default verwijderen, e.d.)."""


# --- lezen ---------------------------------------------------------------------

async def list_profiles() -> list[LlmProfile]:
    return await LlmProfile.find_all().sort("name").to_list()


async def get_profile(name: str) -> LlmProfile | None:
    return await LlmProfile.find_one(LlmProfile.name == name)


async def get_default() -> LlmProfile | None:
    return await LlmProfile.find_one(LlmProfile.is_default == True)  # noqa: E712


async def ensure_exists(name: str) -> None:
    """Werp ProfileError als het profiel niet bestaat (voor request-validatie → 400)."""
    if await get_profile(name) is None:
        raise ProfileError(f"Onbekend model_profile: {name!r}")


# --- resolutie naar een LlmConfig ----------------------------------------------

def _config_uit_env(s: Settings) -> LlmConfig:
    return LlmConfig(
        provider=s.llm_provider,
        model=s.llm_model,
        api_base=s.llm_api_base,
        api_key=s.llm_api_key,
        api_version=s.llm_api_version,
        output_strategy=s.llm_output_strategy,
        temperature=s.llm_temperature,
    )


async def resolve_config(name: str | None, settings: Settings | None = None) -> LlmConfig:
    """Profielnaam → `LlmConfig`. Onbekend/None profiel → env-fallback (faalt niet hard hier;
    de bestaanscheck gebeurt bij het aanmaken van de analyse)."""
    s = settings or get_settings()
    profile = await get_profile(name) if name else await get_default()
    if profile is None:
        return _config_uit_env(s)
    api_key = decrypt(profile.enc_api_key) if profile.enc_api_key else s.llm_api_key
    return LlmConfig(
        provider=profile.provider,
        model=profile.model,
        api_base=profile.api_base,
        api_key=api_key,
        api_version=profile.api_version,
        output_strategy=profile.output_strategy,
        temperature=profile.temperature,
    )


# --- muteren -------------------------------------------------------------------

async def upsert_profile(
    name: str,
    *,
    updated_by: str,
    provider: str | None = None,
    model: str | None = None,
    api_base: str | None = None,
    api_version: str | None = None,
    output_strategy: str | None = None,
    temperature: float | None = None,
    api_key: str | None = None,
    is_default: bool | None = None,
) -> LlmProfile:
    """Maak of werk een profiel bij. Een veld dat `None` is blijft ongewijzigd (PATCH-semantiek).
    Een leeg/None `api_key` laat de bestaande versleutelde key staan; vullen vervangt 'm
    (versleuteld). Het allereerste profiel wordt automatisch default."""
    from .llm_profile import _utcnow

    profile = await get_profile(name)
    is_new = profile is None
    if profile is None:
        profile = LlmProfile(name=name)

    if provider is not None:
        profile.provider = provider
    if model is not None:
        profile.model = model
    if api_base is not None:
        profile.api_base = api_base
    if api_version is not None:
        profile.api_version = api_version or None
    if output_strategy is not None:
        profile.output_strategy = output_strategy
    if temperature is not None:
        profile.temperature = temperature
    if api_key:
        profile.enc_api_key = encrypt(api_key)

    profile.updated_by = updated_by
    profile.updated = _utcnow()

    # Eerste profiel is altijd default; expliciet default zetten verschuift de vlag atomisch.
    geen_profielen = is_new and await LlmProfile.find_all().count() == 0
    if is_default or geen_profielen:
        await _clear_default()
        profile.is_default = True

    await profile.save()
    return profile


async def set_default(name: str) -> LlmProfile:
    profile = await get_profile(name)
    if profile is None:
        raise ProfileError(f"Onbekend model_profile: {name!r}")
    await _clear_default()
    profile.is_default = True
    profile.touch()
    await profile.save()
    return profile


async def delete_profile(name: str) -> None:
    profile = await get_profile(name)
    if profile is None:
        raise ProfileError(f"Onbekend model_profile: {name!r}")
    if profile.is_default:
        raise ProfileError("Kan het default-profiel niet verwijderen; wijs eerst een ander aan.")
    await profile.delete()


async def _clear_default() -> None:
    async for p in LlmProfile.find(LlmProfile.is_default == True):  # noqa: E712
        p.is_default = False
        await p.save()


# --- seeding -------------------------------------------------------------------

async def ensure_seeded(settings: Settings | None = None) -> None:
    """Seed bij de eerste start één default-profiel uit de env-waarden (idempotent)."""
    if await LlmProfile.find_all().count() > 0:
        return
    s = settings or get_settings()
    await LlmProfile(
        name=s.default_model_profile,
        provider=s.llm_provider,
        model=s.llm_model,
        api_base=s.llm_api_base,
        api_version=s.llm_api_version,
        output_strategy=s.llm_output_strategy,
        temperature=s.llm_temperature,
        # Geen enc_api_key: resolve_config valt terug op de env/secret-key.
        is_default=True,
        updated_by="seed",
    ).insert()
