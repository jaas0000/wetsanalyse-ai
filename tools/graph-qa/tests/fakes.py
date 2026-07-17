"""Fakes voor de poorten, zodat de agent-loop deterministisch en zonder netwerk test."""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any


# ---- LLM-response bouwstenen (vorm van de Anthropic-response) ----

def text_block(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=text)


def tool_block(id: str, name: str, input: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=id, name=name, input=input)


def response(content: list[SimpleNamespace], stop_reason: str) -> SimpleNamespace:
    return SimpleNamespace(content=content, stop_reason=stop_reason)


class FakeLLM:
    """Speelt een vaste reeks responses af; onthoudt de create()-aanroepen."""

    def __init__(self, responses: list[SimpleNamespace]) -> None:
        self._responses = list(responses)
        self.index = 0
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        resp = self._responses[self.index]
        self.index += 1
        return resp


class FakeGraph:
    """GraphPort-fake met canned tool-resultaten."""

    def __init__(
        self,
        result_text: str = "",
        tools: list[dict[str, Any]] | None = None,
    ) -> None:
        self._tools = tools or [
            {
                "name": "graphdb_sparql",
                "description": "Voer een SPARQL-query uit.",
                "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
            }
        ]
        self._result_text = result_text
        self.closed = False
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def initialize(self) -> dict[str, Any]:
        return {}

    def list_tools(self) -> list[dict[str, Any]]:
        return self._tools

    def call_tool(self, name: str, arguments: dict[str, Any]) -> list[Any]:
        self.calls.append((name, arguments))
        return [{"type": "text", "text": self._result_text}]

    def close(self) -> None:
        self.closed = True
