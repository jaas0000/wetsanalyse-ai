"""
Grounding-/verificatie: controleert of de citaties in het ANTWOORD herleidbaar zijn
tot de tool-executietrace.

Deterministisch, geen extra LLM-call in het live pad. Bewust op BWB-id-granulariteit:
een citatie geldt als onderbouwd zodra haar BWB-id ergens in de opgehaalde tekst
voorkomt. Zo vangen we het echte falen (een verzonnen regeling/BWB die de graaf nooit
teruggaf) zónder vals alarm op afwijkende jci-formattering of geparafraseerde IRI's.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .models import Source
from .provenance import _BWB_RE, citations_in, first_bwb


@dataclass
class GroundingReport:
    grounded: bool
    cited: list[str] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)


def check_grounding(answer_text: str, source_trace: list[tuple[str, str]]) -> GroundingReport:
    """Markeer citaties in het antwoord waarvan de bron niet in de trace voorkomt."""
    trace_text = "\n".join(t for _, t in source_trace if t)
    cited = citations_in(answer_text)
    unsupported: list[str] = []
    for c in cited:
        bwb = first_bwb(c)
        if bwb is not None:
            if bwb not in trace_text:
                unsupported.append(c)
        elif c not in trace_text:
            unsupported.append(c)
    return GroundingReport(grounded=not unsupported, cited=cited, unsupported=unsupported)


def curate_sources(sources: list[Source], answer_text: str) -> list[Source]:
    """Beperk de bronnenlijst tot regelingen (BWB-id's) die in het antwoord genoemd zijn.

    Coarse op BWB-id zodat alle relevante artikel-/lid-IRI's van een besproken regeling
    behouden blijven, terwijl opgehaalde-maar-onbesproken regelingen wegvallen. Valt terug
    op de volledige lijst als het antwoord geen enkel BWB-id noemt (dan niets weggooien).
    """
    bwbs = set(_BWB_RE.findall(answer_text))
    if not bwbs:
        return sources
    kept = [s for s in sources if any(b in s.uri for b in bwbs)]
    return kept or sources
