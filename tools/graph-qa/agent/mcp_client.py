"""
MCP HTTP client voor de GraphDB MCP-server.

Implementeert het MCP Streamable HTTP transport protocol:
  - POST /mcp  voor initialize / tools/list / tools/call
  - Authorization: Bearer *** server stuurt initialize als plain JSON,
overige calls als SSE (text/event-stream) die direct sluit na het eerste event.
Gebruik httpx.post() (geen streaming) — de server sluit de verbinding zelf.

Eén persistente httpx.Client wordt hergebruikt over alle calls (connection pooling;
scheelt een TCP+TLS-handshake per tool-aanroep). close() sluit die client af.

Veiligheidsnet: call_tool weigert SPARQL-argumenten die eruitzien als een update
(INSERT/DELETE/LOAD/CLEAR/DROP/CREATE). De echte read-only-garantie hoort aan de
serverkant; dit is defense-in-depth zolang het model nog rauwe SPARQL kan sturen.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx


class MCPError(Exception):
    pass


# Update-vormen: een verb gevolgd door typische update-syntax, óf een query die
# (na eventuele PREFIX-regels) met een update-verb begint. Een SELECT met het woord
# "delete" in een FILTER tript hier bewust niet op.
_UPDATE_RE = re.compile(
    r"\b(?:insert|delete)\s+(?:data|where)\b"
    r"|\b(?:insert|delete)\s*\{"
    r"|^\s*(?:insert|delete|load|clear|drop|create|copy|move|add)\b",
    re.IGNORECASE | re.MULTILINE,
)


def _looks_like_update(query: str) -> bool:
    return bool(_UPDATE_RE.search(query))


def _content_to_text(content: list[Any]) -> str:
    """Plat een MCP-content-lijst tot één tekst."""
    parts = []
    for item in content:
        if isinstance(item, dict):
            parts.append(item.get("text", str(item)))
        else:
            parts.append(str(item))
    return "\n".join(parts)


class MCPClient:
    """Dunne synchrone client voor de GraphDB MCP-server."""

    def __init__(
        self,
        url: str | None = None,
        token: str | None = None,
        timeout: float = 30.0,
        repository_id: str | None = None,
        sparql_tool: str = "sparql_query",
        similarity_index: str = "",
    ) -> None:
        self.url = (url or os.environ["GRAPHDB_MCP_URL"]).rstrip("/")
        token = token or os.environ["GRAPHDB_TOKEN"]
        self._auth_header = f"Bearer {token}"
        self._timeout = timeout
        self._repository_id = repository_id or os.environ.get("GRAPHDB_REPOSITORY_ID", "inning")
        self._sparql_tool = sparql_tool
        self._similarity_index = similarity_index
        self._session_id: str | None = None
        self._client = httpx.Client(
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0),
        )

    # ------------------------------------------------------------------
    # Intern: JSON-RPC over MCP HTTP
    # ------------------------------------------------------------------

    def _rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
        }
        if params:
            payload["params"] = params

        headers = {
            "Authorization": self._auth_header,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id

        resp = self._client.post(self.url, json=payload, headers=headers)

        # Sla session-id op
        sid = resp.headers.get("Mcp-Session-Id")
        if sid:
            self._session_id = sid

        if resp.status_code == 202:
            return None

        ct = resp.headers.get("content-type", "")

        if "text/event-stream" in ct:
            return self._parse_sse_body(resp.text)
        else:
            try:
                data = resp.json()
            except Exception as exc:
                raise MCPError(
                    f"Geen geldige JSON van MCP-server: {resp.text[:200]}"
                ) from exc
            if "error" in data:
                raise MCPError(f"MCP-fout: {data['error']}")
            return data.get("result")

    @staticmethod
    def _parse_sse_body(text: str) -> Any:
        """Haal het eerste JSON-RPC result-object uit een SSE-response body."""
        for line in text.splitlines():
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if "result" in msg:
                return msg["result"]
            if "error" in msg:
                raise MCPError(f"MCP-fout (SSE): {msg['error']}")
        raise MCPError(f"Geen bruikbaar resultaat in SSE-response: {text[:200]}")

    # ------------------------------------------------------------------
    # Publieke interface
    # ------------------------------------------------------------------

    def initialize(self) -> dict[str, Any]:
        """Handshake met de MCP-server; retourneert server-capabilities."""
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "graph-qa", "version": "0.1.0"},
            },
        )
        # notifications/initialized is optioneel; GraphDB hangt bij die call.
        return result or {}

    def list_tools(self) -> list[dict[str, Any]]:
        result = self._rpc("tools/list")
        if result is None:
            return []
        return result.get("tools", [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        self._reject_updates(arguments)
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        if result is None:
            return []
        return result.get("content", [])

    def sparql(self, query: str) -> str:
        """Voer een read-only SPARQL-query uit via de MCP-sparql-tool."""
        content = self.call_tool(
            self._sparql_tool,
            {"query": query, "repositoryId": self._repository_id},
        )
        return _content_to_text(content)

    def semantic_search(self, query: str, limit: int = 10) -> str:
        """Semantisch zoeken via de GraphDB-similarity-index (MCP-tool similarity_search)."""
        content = self.call_tool(
            "similarity_search",
            {
                "query": query,
                "similarityIndex": self._similarity_index,
                "connectorType": "similarity",
                "repositoryId": self._repository_id,
                "limit": limit,
            },
        )
        return _content_to_text(content)

    @staticmethod
    def _reject_updates(arguments: dict[str, Any]) -> None:
        """Weiger argumenten die een SPARQL-update bevatten (read-only vangnet)."""
        for value in arguments.values():
            if isinstance(value, str) and _looks_like_update(value):
                raise MCPError(
                    "Geweigerd: alleen read-only SPARQL is toegestaan "
                    "(update-sleutelwoord aangetroffen)."
                )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "MCPClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
