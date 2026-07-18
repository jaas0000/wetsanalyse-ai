"""
Scorers voor het eval-harnas. Puur en deterministisch, los te unit-testen.

Metingen per case:
  - citaat-faithfulness  : aandeel citaties in het antwoord dat door de trace wordt gedekt
                           (uit het grounding-event; doel 1.0).
  - bron-recall          : aandeel verwachte bronnen (BWB-id/IRI) dat in de bronnenlijst zit.
  - contains             : verwachte deelstrings staan in het antwoord.
  - refusal              : off-topic vraag → geweigerd (geen bronnen); on-topic → beantwoord.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def faithfulness(grounding: dict[str, Any]) -> float:
    cited = int(grounding.get("cited", 0) or 0)
    unsupported = len(grounding.get("unsupported", []) or [])
    if cited == 0:
        return 1.0
    return max(0.0, 1.0 - unsupported / cited)


def source_recall(sources: list[dict[str, Any]], expected: list[str]) -> float:
    if not expected:
        return 1.0
    blob = " ".join(s.get("uri", "") for s in sources)
    hit = sum(1 for e in expected if e in blob)
    return hit / len(expected)


def contains_ok(answer: str, expected: list[str]) -> bool:
    low = answer.lower()
    return all(e.lower() in low for e in (expected or []))


def refusal_ok(sources: list[dict[str, Any]], should_refuse: bool) -> bool:
    refused = len(sources) == 0
    return refused if should_refuse else not refused


@dataclass
class CaseResult:
    question: str
    faithfulness: float
    source_recall: float
    contains_ok: bool
    refusal_ok: bool
    error: str | None = None
    passed: bool = field(init=False)

    def __post_init__(self) -> None:
        self.passed = (
            self.error is None
            and self.faithfulness >= 1.0
            and self.source_recall >= 1.0
            and self.contains_ok
            and self.refusal_ok
        )


def score_case(
    case: dict[str, Any],
    answer: str,
    sources: list[dict[str, Any]],
    grounding: dict[str, Any],
    error: str | None = None,
) -> CaseResult:
    should_refuse = bool(case.get("should_refuse", False))
    return CaseResult(
        question=case.get("question", ""),
        faithfulness=faithfulness(grounding),
        source_recall=source_recall(sources, case.get("expected_sources", [])),
        contains_ok=contains_ok(answer, case.get("expected_contains", [])),
        refusal_ok=refusal_ok(sources, should_refuse),
        error=error,
    )
