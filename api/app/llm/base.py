"""Het LLMClient-protocol + resultaattype.

De adapter (niet de caller) kapselt provider-verschillen in: system/user-mapping,
output-strategie en JSON-parsing. De caller geeft een schema en krijgt een dict terug.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class LlmConfig:
    """Resolved configuratie voor één LLM-call — afgeleid uit een modelprofiel (of env-fallback).

    Maakt de adapter onafhankelijk van Settings: per analyse kan een ander profiel (en dus een
    andere `LlmConfig`) gelden, runtime-beheerbaar via de admin-UI.
    """

    provider: str = "azure_ai"
    model: str = ""
    api_base: str = ""
    api_key: str | None = None
    api_version: str | None = None
    output_strategy: str = "prompt_and_parse"
    temperature: float = 0.0


@dataclass
class LLMResult:
    data: dict
    model: str = ""
    provider: str = ""
    output_strategie: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    ruwe_tekst: str = field(default="", repr=False)


class LLMError(RuntimeError):
    """Het LLM leverde geen bruikbare/parseerbare JSON na een reparatiepoging."""


@runtime_checkable
class LLMClient(Protocol):
    async def complete(self, system: str, user: str, schema: dict | None = None) -> LLMResult:
        """Genereer JSON conform `schema`. Werpt LLMError bij onparseerbaar resultaat."""
        ...


def parse_json_strict(tekst: str) -> dict:
    """Parse JSON; strip defensief code-fences en eventuele preamble vóór het eerste '{'."""
    kandidaat = _FENCE.sub("", tekst.strip())
    try:
        return json.loads(kandidaat)
    except json.JSONDecodeError:
        # Val terug op het grootste {...}-blok.
        start = kandidaat.find("{")
        end = kandidaat.rfind("}")
        if start != -1 and end > start:
            return json.loads(kandidaat[start : end + 1])
        raise
