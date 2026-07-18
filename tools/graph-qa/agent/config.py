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

    # Agent-loop
    max_turns: int = 20

    # Geheugen
    memory_db_path: str | None = None

    # API-laag
    qa_api_token: str | None = None
    cors_origins: list[str] = ["*"]
    rate_limit: int = 60          # verzoeken per venster (per proces, per IP)
    rate_window_seconds: float = 60.0

    # Orkestrator
    enable_planning: bool = True      # lichte plan-node vóór de agent (plan→retrieve→reason→verify)
    enable_memory_context: bool = True  # eerder geraadpleegde bepalingen als pointer-context injecteren

    # Geheugen (LangGraph-checkpointer). Pad gezet → durable AsyncSqliteSaver; None → in-memory.
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
            "max_turns": e.get("MAX_TURNS"),
            "memory_db_path": e.get("MEMORY_DB_PATH"),
            "qa_api_token": _read_secret(e, "QA_API_TOKEN"),
            "cors_origins": cors or None,
            "rate_limit": e.get("QA_RATE_LIMIT"),
            "otel_endpoint": e.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
            "otel_service_name": e.get("OTEL_SERVICE_NAME"),
            "log_format": e.get("LOG_FORMAT"),
            "log_level": e.get("LOG_LEVEL"),
            "checkpoint_db_path": e.get("CHECKPOINT_DB_PATH"),
        }
        # None weglaten zodat de veld-defaults van kracht blijven
        return cls(**{k: v for k, v in raw.items() if v is not None})

    def require_llm(self) -> None:
        if not self.azure_foundry_api_key or not self.azure_foundry_base_url:
            raise ValueError(
                "LLM niet geconfigureerd: zet AZURE_FOUNDRY_API_KEY en AZURE_FOUNDRY_BASE_URL."
            )

    def require_graph(self) -> None:
        if not self.graphdb_token:
            raise ValueError("Graaf niet geconfigureerd: zet GRAPHDB_TOKEN.")
