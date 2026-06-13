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

        # --- Admin-auth: aparte tokens voor /v1/admin/* (LLM-beheer) ---
        raw_admin = _read_secret("WETSANALYSE_ADMIN_TOKENS") or ""
        self.admin_tokens: dict[str, str] = {}
        for part in raw_admin.split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            admin_id, token = part.split(":", 1)
            self.admin_tokens[token.strip()] = admin_id.strip()

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

        # Master key voor versleuteling-at-rest van via de admin-UI opgeslagen API-keys.
        # Geldige Fernet-key (32 url-safe base64-bytes); ontbreekt 'ie → geen key-opslag (fail-closed).
        self.llm_config_secret = _read_secret("LLM_CONFIG_SECRET")

        # Benoemde profielen → geen vrije model-string vanuit de client (governance).
        # De profielen leven in MongoDB (beheerbaar via /v1/admin/profiles); de env-waarden
        # hierboven seeden bij de eerste start één default-profiel (zie app/profiles.py) en
        # blijven de fallback wanneer een profiel geen eigen API-key heeft.
        self.default_model_profile = os.environ.get("LLM_DEFAULT_PROFILE", "azure-sonnet")

        # --- MongoDB ---
        # Connection string via secret (MONGODB_URL_FILE) zodat ingebedde credentials niet als
        # plain env in de container/Portainer-UI staan; valt terug op MONGODB_URL voor lokaal.
        self.mongodb_url = _read_secret("MONGODB_URL") or "mongodb://localhost:27017"
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

        # --- Misbruik-/kostenbeheersing (0 = uit) ---
        # Per-client request-rate op de muterende endpoints.
        self.rate_limit_max = int(os.environ.get("WETSANALYSE_RATE_LIMIT_MAX", "30"))
        self.rate_limit_window_s = float(os.environ.get("WETSANALYSE_RATE_LIMIT_WINDOW", "60"))
        # Max gelijktijdig lopende (niet-terminale) analyses per client.
        self.max_active_jobs = int(os.environ.get("WETSANALYSE_MAX_ACTIVE_JOBS", "5"))
        # Token-budget per analyse; bij overschrijding stopt de job (FoutKlasse.quota).
        self.llm_token_budget = int(os.environ.get("WETSANALYSE_LLM_TOKEN_BUDGET", "0"))

        self.analyses_dir = Path(
            os.environ.get("WETSANALYSE_ANALYSES_DIR", str(ANALYSES_DIR))
        )

@lru_cache
def get_settings() -> Settings:
    return Settings()
