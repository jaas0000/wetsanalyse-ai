"""
Centrale configuratie: één gevalideerd Settings-model dat de omgeving één keer
inleest, zodat de rest van de code niet meer verspreid os.environ hoeft te raadplegen.

We gebruiken bewust een gewone pydantic BaseModel + from_env() i.p.v. pydantic-settings:
zelfde effect (validatie, één inleespunt), maar geen extra runtime-dependency.
De secrets zijn optioneel zodat import en /health blijven werken zonder volledige
config; de agent roept require_llm()/require_graph() aan zodra hij ze echt nodig heeft.
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from pydantic import BaseModel


def _pakketversie() -> str:
    """De versie van deze agent, voor de herkomst bij een annotatie. Onbekend → lege string:
    liever geen versie dan een verzonnen versie."""
    try:
        from importlib.metadata import version

        return version("graph-qa")
    except Exception:
        return ""


def _read_secret(env: Mapping[str, str], name: str) -> str | None:
    """Lees een secret: eerst `<NAME>_FILE` (host-bestand, Docker-conventie), anders `<NAME>`."""
    path = env.get(name + "_FILE")
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            return None
    return env.get(name)


class Settings(BaseModel):
    # GraphDB MCP
    graphdb_mcp_url: str = "https://graphdb-mcp.ipalm.nl/mcp"
    graphdb_token: str | None = None
    repository_id: str = "inning"
    graphdb_sparql_tool: str = "sparql_query"  # naam van de SPARQL-tool op de MCP-server
    similarity_index: str = ""                 # GraphDB similarity-index voor semantic_search; leeg = uit

    # LLM (Azure AI Foundry / Anthropic)
    azure_foundry_api_key: str | None = None
    azure_foundry_base_url: str | None = None
    llm_model: str = "claude-sonnet-4-6"
    # Herkomst die met elke annotatie meereist: welk model/welke agentversie het voorstel maakte.
    # `llm_provider` is beschrijvend (de adapter praat via Azure AI Foundry met de Anthropic-SDK);
    # `agent_versie` komt uit de image-tag/env en valt terug op de pakketversie.
    llm_provider: str = "anthropic_via_azure_foundry"
    agent_versie: str = ""

    # Agent-loop
    max_turns: int = 20
    # Cap op de historie die per beurt naar de LLM gaat (tegen onbegrensde promptgroei in een lange
    # sessie). Char-budget; 0 = uit. Ruim genoeg dat de huidige vraag + tool-resultaten altijd passen.
    max_history_chars: int = 40000

    # API-laag
    qa_api_token: str | None = None
    cors_origins: list[str] = ["*"]
    rate_limit: int = 60          # verzoeken per venster (per proces, per IP)
    rate_window_seconds: float = 60.0
    # Achter een reverse proxy: de eerste X-Forwarded-For-hop als client-IP nemen voor de rate-limit.
    # Standaard uit (peer-IP), zodat een gespooft header de limiet niet omzeilt tenzij bewust aangezet.
    trust_proxy: bool = False

    # Orkestrator
    enable_planning: bool = True      # lichte plan-node vóór de agent (plan→retrieve→reason→verify)
    enable_memory_context: bool = True  # eerder geraadpleegde bepalingen als pointer-context injecteren

    # Decompositie (multi-hop): samengestelde vraag → deelvragen → retrieval per deelvraag → synthese.
    # Uit = de bestaande één-loop-stroom (byte-voor-byte ongewijzigd).
    enable_decomposition: bool = False
    max_subquestions: int = 5         # cap op het aantal deelvragen (kosten/latency begrenzen)
    sub_max_turns: int = 8            # agent⇄tools-beurten per deelvraag (los van max_turns)

    # Herzieningslus annoteerder ⇄ Critic: hoeveel keer de annoteerder een Critic-instructie mag
    # verwerken vóór de jurist het ziet. Elke ronde kost een annoteer- én een critic-call met het
    # volle corpus, dus dit is de kosten-/latency-knop. **0 = uit**, en dan is de keten exact de
    # oude `annoteer → critic → emit` — de veiligheidsklep om dit zonder rollback terug te draaien.
    critic_max_rondes: int = 2

    # Geheugen (LangGraph-checkpointer). Voorrang: `checkpoint_db_url` (Postgres, gedeeld → horizontaal
    # veilig) → anders `checkpoint_db_path` (durable AsyncSqliteSaver, per-instance) → anders in-memory.
    checkpoint_db_url: str | None = None
    checkpoint_db_path: str | None = "conversations_checkpoints.db"

    # Grounding
    grounding_correct: bool = False   # bij niet-onderbouwde citaties één corrigerende her-vraag
    curate_sources: bool = True       # bronnenlijst beperken tot in het antwoord aangehaalde regelingen

    # Observability (gated op otel_endpoint; leeg = alleen JSON-logs)
    otel_endpoint: str = ""
    otel_service_name: str = "graph-qa"
    otel_metrics_enabled: bool = True
    log_format: str = "json"
    log_level: str = "info"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        e = env if env is not None else os.environ
        cors = [o.strip() for o in e.get("CORS_ORIGINS", "*").split(",") if o.strip()]
        raw: dict[str, object] = {
            "graphdb_mcp_url": e.get("GRAPHDB_MCP_URL"),
            "graphdb_token": _read_secret(e, "GRAPHDB_TOKEN"),
            "repository_id": e.get("GRAPHDB_REPOSITORY_ID"),
            "graphdb_sparql_tool": e.get("GRAPHDB_SPARQL_TOOL"),
            "similarity_index": e.get("SIMILARITY_INDEX"),
            "azure_foundry_api_key": _read_secret(e, "AZURE_FOUNDRY_API_KEY"),
            "azure_foundry_base_url": e.get("AZURE_FOUNDRY_BASE_URL"),
            "llm_model": e.get("LLM_MODEL"),
            "llm_provider": e.get("LLM_PROVIDER"),
            "agent_versie": e.get("AGENT_VERSION") or _pakketversie(),
            "max_turns": e.get("MAX_TURNS"),
            "max_history_chars": e.get("MAX_HISTORY_CHARS"),
            "enable_decomposition": e.get("ENABLE_DECOMPOSITION"),
            "max_subquestions": e.get("MAX_SUBQUESTIONS"),
            "sub_max_turns": e.get("SUB_MAX_TURNS"),
            "critic_max_rondes": e.get("CRITIC_MAX_RONDES"),
            "qa_api_token": _read_secret(e, "QA_API_TOKEN"),
            "cors_origins": cors or None,
            "rate_limit": e.get("QA_RATE_LIMIT"),
            "rate_window_seconds": e.get("QA_RATE_WINDOW_SECONDS"),
            "trust_proxy": e.get("TRUST_PROXY"),
            "otel_endpoint": e.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
            "otel_service_name": e.get("OTEL_SERVICE_NAME"),
            "log_format": e.get("LOG_FORMAT"),
            "log_level": e.get("LOG_LEVEL"),
            "checkpoint_db_url": _read_secret(e, "CHECKPOINT_DB_URL"),
            "checkpoint_db_path": e.get("CHECKPOINT_DB_PATH"),
        }
        # None én lege string weglaten zodat de veld-defaults van kracht blijven (een gezet-maar-leeg
        # MAX_TURNS="" e.d. zou anders bij pydantic-coercie de import laten crashen i.p.v. de default te nemen)
        return cls(**{k: v for k, v in raw.items() if v is not None and v != ""})

    def require_llm(self) -> None:
        if not self.azure_foundry_api_key or not self.azure_foundry_base_url:
            raise ValueError(
                "LLM niet geconfigureerd: zet AZURE_FOUNDRY_API_KEY en AZURE_FOUNDRY_BASE_URL."
            )

    def require_graph(self) -> None:
        if not self.graphdb_token:
            raise ValueError("Graaf niet geconfigureerd: zet GRAPHDB_TOKEN.")
