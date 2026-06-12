"""Configuratie en projectpaden.

Bewust env-gebaseerd en zonder extra dependency (geen pydantic-settings). Alle paden zijn
afgeleid van de projectroot zodat de service portabel blijft, net als de rest van het project.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

# api/app/config.py -> api/app -> api -> <projectroot>
PROJECT_ROOT = Path(__file__).resolve().parents[2]

SKILL_DIR = PROJECT_ROOT / ".claude" / "skills" / "wetsanalyse"
SKILL_SCRIPTS = SKILL_DIR / "scripts"
REFERENCES_DIR = SKILL_DIR / "references"
ANALYSES_DIR = PROJECT_ROOT / "analyses"


def _read_secret(env_name: str) -> str | None:
    """Lees een secret uit `${NAME}` of, als `${NAME}_FILE` is gezet, uit dat bestand.

    Het *_FILE-patroon spiegelt de MCP (Docker secret/vault) — secrets niet als plain env.
    """
    file_var = os.environ.get(f"{env_name}_FILE")
    if file_var:
        try:
            return Path(file_var).read_text(encoding="utf-8").strip()
        except OSError:
            return None
    val = os.environ.get(env_name)
    return val.strip() if val else None


class Settings:
    """Runtime-instellingen, één keer ingelezen uit de omgeving."""

    def __init__(self) -> None:
        # --- Auth: per-client tokens "id:token,id2:token2" (erf het MCP-patroon) ---
        raw_tokens = _read_secret("WETSANALYSE_API_TOKENS") or ""
        self.client_tokens: dict[str, str] = {}
        for part in raw_tokens.split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            client_id, token = part.split(":", 1)
            self.client_tokens[token.strip()] = client_id.strip()
        # Fail-closed: leeg betekent "auth verplicht maar geen tokens" → alles 401.
        self.auth_required = os.environ.get("WETSANALYSE_AUTH_REQUIRED", "1") != "0"

        # --- Wettenbank-MCP (intern netwerk in productie) ---
        self.mcp_url = os.environ.get(
            "WETTENBANK_MCP_URL", "https://wettenbank-mcp.ipalm.nl/mcp"
        )
        self.mcp_token = _read_secret("WETTENBANK_TOKEN")
        self.mcp_timeout_s = float(os.environ.get("WETTENBANK_MCP_TIMEOUT", "30"))

        # --- LLM-adapter ---
        # Endpointtype bepaalt provider-prefix/auth (zie Fase 0): azure_ai (Foundry/MaaS) vs azure (OpenAI).
        self.llm_provider = os.environ.get("LLM_PROVIDER", "azure_ai")
        self.llm_model = os.environ.get("LLM_MODEL", "")
        self.llm_api_base = os.environ.get("LLM_API_BASE", "")
        self.llm_api_key = _read_secret("LLM_API_KEY")
        self.llm_api_version = os.environ.get("LLM_API_VERSION")  # alleen Azure-OpenAI
        self.llm_output_strategy = os.environ.get("LLM_OUTPUT_STRATEGY", "prompt_and_parse")
        self.llm_temperature = float(os.environ.get("LLM_TEMPERATURE", "0"))

        # Benoemde profielen → geen vrije model-string vanuit de client (governance).
        # Default-profiel "azure-sonnet" verwijst naar de hierboven geconfigureerde waarden.
        self.model_profiles: dict[str, dict[str, str]] = {
            "azure-sonnet": {
                "provider": self.llm_provider,
                "model": self.llm_model,
            },
        }
        self.default_model_profile = os.environ.get("LLM_DEFAULT_PROFILE", "azure-sonnet")

        # --- MongoDB ---
        self.mongodb_url = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
        self.mongodb_db = os.environ.get("MONGODB_DB", "wetsanalyse")

        # --- CORS ---
        raw_origins = os.environ.get("CORS_ORIGINS", "*")
        self.cors_origins: list[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]

        # --- Build-herkomst (door CI meegegeven; zichtbaar op /health) ---
        self.git_sha = os.environ.get("GIT_SHA", "")
        self.build_time = os.environ.get("BUILD_TIME", "")

        # --- Engine ---
        self.max_rondes = int(os.environ.get("WETSANALYSE_MAX_RONDES", "6"))
        self.max_autocorrectie = int(os.environ.get("WETSANALYSE_MAX_AUTOCORRECTIE", "1"))
        # Bounded retry op transiënte LLM/MCP-fouten (429/5xx/timeout) vóór terminale `fout`.
        self.transient_max_retries = int(os.environ.get("WETSANALYSE_TRANSIENT_MAX_RETRIES", "2"))
        self.transient_backoff_s = float(os.environ.get("WETSANALYSE_TRANSIENT_BACKOFF", "0.5"))
        self.analyses_dir = Path(
            os.environ.get("WETSANALYSE_ANALYSES_DIR", str(ANALYSES_DIR))
        )

    def resolve_profile(self, naam: str | None) -> dict[str, str]:
        key = naam or self.default_model_profile
        if key not in self.model_profiles:
            raise KeyError(f"Onbekend model_profile: {key!r}")
        return self.model_profiles[key]


@lru_cache
def get_settings() -> Settings:
    return Settings()
