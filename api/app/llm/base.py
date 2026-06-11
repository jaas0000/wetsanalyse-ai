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
