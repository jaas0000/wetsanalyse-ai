"""
Poorten (Protocols) die de agent-loop scheiden van concrete providers.

De loop praat uitsluitend via deze interfaces, zodat tests een fake kunnen
injecteren zonder netwerk, en zodat een tweede LLM-/graaf-provider later een
kwestie van een nieuwe adapter is.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class GraphPort(Protocol):
    """Toegang tot de kennisgraaf via de MCP-server (of een fake)."""

    def initialize(self) -> dict[str, Any]: ...

    def list_tools(self) -> list[dict[str, Any]]: ...

    def call_tool(self, name: str, arguments: dict[str, Any]) -> list[Any]: ...

    def close(self) -> None: ...


@runtime_checkable
class LLMPort(Protocol):
    """Eén blocking chat-completion met tool-use.

    Retourneert het provider-native response-object (blokken met .type/.text/
    .id/.name/.input en een .stop_reason); de loop leest daar direct uit, en een
    fake kan hetzelfde vormpje teruggeven.
    """

    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> Any: ...
