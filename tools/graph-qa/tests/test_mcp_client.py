"""semantic_search: MCPClient bouwt de juiste similarity_search-argumenten."""
from __future__ import annotations

from agent.mcp_client import MCPClient


def test_semantic_search_gebruikt_similarity_search():
    c = MCPClient(url="http://x/mcp", token="t", repository_id="inning", similarity_index="bwb_similarity")
    captured: dict = {}

    def _fake_call_tool(name, arguments):
        captured["name"] = name
        captured["arguments"] = arguments
        return [{"type": "text", "text": "resultaat"}]

    c.call_tool = _fake_call_tool  # type: ignore[assignment]
    out = c.semantic_search("belasting niet op tijd betaald", limit=5)

    assert out == "resultaat"
    assert captured["name"] == "similarity_search"
    args = captured["arguments"]
    assert args["similarityIndex"] == "bwb_similarity"
    assert args["connectorType"] == "similarity"
    assert args["repositoryId"] == "inning"
    assert args["query"] == "belasting niet op tijd betaald"
