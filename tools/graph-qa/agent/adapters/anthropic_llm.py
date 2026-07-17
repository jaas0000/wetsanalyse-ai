"""
LLMPort-adapter voor Anthropic via Azure AI Foundry.

Verhuisd uit de agent-loop: hier zit de enige plek die de concrete Anthropic-client
en de Azure-Foundry-details (base_url, api-version) kent.
"""
from __future__ import annotations

from typing import Any

import anthropic

from ..config import Settings


class AnthropicLLM:
    """Dunne, blocking implementatie van LLMPort."""

    def __init__(self, settings: Settings) -> None:
        settings.require_llm()
        self._client = anthropic.Anthropic(
            api_key=settings.azure_foundry_api_key,
            base_url=settings.azure_foundry_base_url.rstrip("/"),
            default_query={"api-version": "2025-04-15"},
            timeout=120.0,
        )

    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
    ) -> Any:
        return self._client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            tools=tools,
            messages=messages,
        )
