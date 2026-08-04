"""GraphDB-MCP-client — bron voor de agentische act-2-generatie (read-only SPARQL).

Spiegelt `wettenbank.WettenbankClient` (async, via de officiële `mcp`-streamable-HTTP-client), maar
praat met de GraphDB-MCP: één tool `sparql_query` met `{query, repositoryId}`, resultaat = één
text-block met de SPARQL-TSV (JSON-string-encoded). Parse met `graph_queries.parse_select`.

Read-only vangnet (`_reject_updates`) spiegelt `tools/graph-qa/agent/mcp_client.py`: het model mag
via tools SPARQL sturen, dus updates worden geweigerd. De GRAPHDB_TOKEN is verplicht om te genereren.
"""

from __future__ import annotations

import asyncio
import re

from .config import Settings

# Update-vormen: een verb gevolgd door typische update-syntax, óf een query die met een update-verb
# begint. Een SELECT met het woord "delete" in een FILTER tript hier bewust niet op.
_UPDATE_RE = re.compile(
    r"\b(?:insert|delete)\s+(?:data|where)\b"
    r"|\b(?:insert|delete)\s*\{"
    r"|^\s*(?:insert|delete|load|clear|drop|create|copy|move|add)\b",
    re.IGNORECASE | re.MULTILINE,
)


class GraphDBError(RuntimeError):
    """GraphDB-ophalen mislukte — de act-2-generatie moet stoppen, niet stil doorgaan.

    `klasse` (mirror van WettenbankError) laat retry permanente fouten (bv. bron niet in de graaf)
    onderscheiden van tijdelijke haperingen; None = transportfout (transiënt, mag geretryed worden).
    """

    def __init__(self, message: str, *, klasse: str | None = None) -> None:
        super().__init__(message)
        self.klasse = klasse


def _diepste_fout(e: BaseException) -> BaseException:
    """Loop door een (anyio-)ExceptionGroup naar de eigenlijke onderliggende fout."""
    excs = getattr(e, "exceptions", None)
    while excs:
        e = excs[0]
        excs = getattr(e, "exceptions", None)
    return e


class GraphDBClient:
    def __init__(self, settings: Settings) -> None:
        self.url = settings.graphdb_mcp_url
        self.token = settings.graphdb_token
        self.repository_id = settings.graphdb_repository_id
        self.sparql_tool = settings.graphdb_sparql_tool
        self.timeout = settings.graphdb_timeout_s

    async def sparql(self, query: str) -> str:
        """Voer een read-only SELECT/ASK uit en geef de rauwe resultaattekst (TSV) terug."""
        if _UPDATE_RE.search(query or ""):
            raise GraphDBError("Geweigerd: alleen read-only SPARQL is toegestaan.")
        try:
            return await asyncio.wait_for(
                self._call(self.sparql_tool, {"query": query, "repositoryId": self.repository_id}),
                timeout=self.timeout,
            )
        except asyncio.TimeoutError as e:
            raise GraphDBError(f"GraphDB-timeout na {self.timeout}s") from e
        except GraphDBError:
            raise
        except Exception as e:  # noqa: BLE001 — alle transportfouten → GraphDBError
            inner = _diepste_fout(e)
            if isinstance(inner, GraphDBError):
                raise inner from e
            raise GraphDBError(f"GraphDB-MCP-fout: {inner}") from e

    async def _call(self, tool: str, args: dict) -> str:
        # Lazy import: de mcp-client is alleen nodig bij echt ophalen, niet in elke testopzet.
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        headers = {"Authorization": f"Bearer {self.token}"} if self.token else None
        async with streamablehttp_client(self.url, headers=headers) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, args)
        return self._parse(tool, result)

    @staticmethod
    def _parse(tool: str, result) -> str:
        blocks = getattr(result, "content", None) or []
        teksten = [getattr(b, "text", "") for b in blocks if getattr(b, "type", "") == "text"]
        if getattr(result, "isError", False):
            raise GraphDBError(f"GraphDB-MCP-fout voor {tool}: {teksten[0] if teksten else '(leeg)'}")
        if not teksten:
            raise GraphDBError(f"GraphDB gaf geen tekst terug voor {tool}")
        return teksten[0]
