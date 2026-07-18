"""PR 2.5: MCPClient.semantic_search bouwt de juiste retrieval_search-argumenten."""
from __future__ import annotations

from agent.mcp_client import MCPClient


def test_semantic_search_gebruikt_retrieval_search_met_connector():
    c = MCPClient(url="http://x/mcp", token="t", repository_id="inning", retrieval_connector="bwb_embeddings")
    captured: dict = {}

    def _fake_call_tool(name, arguments):
        captured["name"] = name
        captured["arguments"] = arguments
        return [{"type": "text", "text": "resultaat"}]

    c.call_tool = _fake_call_tool  # type: ignore[assignment]
    out = c.semantic_search("belasting niet op tijd betaald", limit=5)

    assert out == "resultaat"
    assert captured["name"] == "retrieval_search"
    assert captured["arguments"]["connectorInstance"] == "bwb_embeddings"
    assert "belasting niet op tijd betaald" in str(captured["arguments"])
