"""
GraphPort-adapter voor de GraphDB MCP-server.

De bestaande MCPClient voldoet al aan het GraphPort-protocol; deze factory bouwt er
één uit Settings, zodat de agent-loop niet zelf de url/token hoeft te kennen.
"""
from __future__ import annotations

from ..config import Settings
from ..mcp_client import MCPClient
from ..ports import GraphPort


def make_graph(settings: Settings) -> GraphPort:
    settings.require_graph()
    return MCPClient(url=settings.graphdb_mcp_url, token=settings.graphdb_token)
