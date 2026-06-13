"""Beanie Document voor een benoemd LLM-modelprofiel.

Profielen vervangen de vroegere hardcoded `Settings.model_profiles`: ze leven in MongoDB en
zijn beheerbaar via /v1/admin/profiles (geen redeploy nodig). De client kiest een profiel op
naam (governance: geen vrije model-string); het gekozen profiel stuurt het feitelijke model
aan (zie app/profiles.py → app/engine/orchestrator.py).

De API-key staat versleuteld in `enc_api_key` (Fernet, zie secrets_crypto). De plaintext-key
verlaat de server nooit via de API — admin-responses tonen alleen `api_key_set: bool`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LlmProfile(Document):
    name: str
    provider: str = "azure_ai"
    model: str = ""
    api_base: str = ""
    api_version: str | None = None
    output_strategy: str = "prompt_and_parse"
    temperature: float = 0.0
    # Versleutelde API-key (Fernet-token). Leeg ⇒ val terug op de env-LLM_API_KEY.
    enc_api_key: str | None = None
    is_default: bool = False

    updated_by: str = ""
    created: datetime = Field(default_factory=_utcnow)
    updated: datetime = Field(default_factory=_utcnow)

    def touch(self) -> None:
        self.updated = _utcnow()

    class Settings:
        name = "llm_profiles"
        indexes = [
            IndexModel([("name", ASCENDING)], unique=True),
        ]
