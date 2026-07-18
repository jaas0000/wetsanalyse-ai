"""Fakes voor de poorten, zodat de agent-loop deterministisch en zonder netwerk test."""
from __future__ import annotations

from collections.abc import Callable
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
    """GraphPort-fake: onthoudt de uitgevoerde SPARQL en geeft canned tekst terug."""

    def __init__(
        self,
        result: str = "",
        results: Callable[[str], str] | None = None,
    ) -> None:
        self._result = result
        self._results = results
        self.queries: list[str] = []
        self.closed = False

    def initialize(self) -> dict[str, Any]:
        return {}

    def sparql(self, query: str) -> str:
        self.queries.append(query)
        if self._results is not None:
            return self._results(query)
        return self._result

    def close(self) -> None:
        self.closed = True
