"""
Bron-provenance uit de tool-executietrace.

Kern van de juridische betrouwbaarheid: bronnen komen uit wat de graaf
daadwerkelijk terugstuurde, NIET uit de prozatekst van het model. Zo passeert een
gehallucineerde citatie niet als "bron", en gaat een echte vindplaats niet verloren
als het model de IRI parafraseert zonder hem uit te typen.

We herkennen in de tool-output:
  - document-IRI's in de eigen graafruimte  (https://ipalm.nl/bwb/...)
  - jci-vindplaatsstrings                    (jci1.3:c:BWBR....)
  - kale BWB-id's                            (BWBR\\d+), alleen als losse bron
De vocabulaire-namespace (https://ipalm.nl/ns/bwb#...) valt er bewust buiten:
dat zijn predicaten, geen vindplaatsen.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from .models import Source

_IRI_RE = re.compile(r"https?://ipalm\.nl/bwb/[^\s\"'<>)\]}]+")
_JCI_RE = re.compile(r"jci[\d.]+:c:BWBR\d+[^\s\"'<>)\]}]*")
_BWB_RE = re.compile(r"\bBWBR\d+\b")


def _clean(uri: str) -> str:
    return uri.rstrip(".,;")


def collect_sources(entries: Iterable[tuple[str, str]]) -> list[Source]:
    """Bouw een ontdubbelde bronnenlijst uit (tool_naam, resultaat_tekst)-paren."""
    sources: list[Source] = []
    seen: set[str] = set()

    def add(uri: str, tool: str, *, iri: str | None = None, jci: str | None = None) -> None:
        uri = _clean(uri)
        if uri in seen:
            return
        seen.add(uri)
        sources.append(Source(label=uri, uri=uri, iri=iri, jci=jci, origin_tool=tool))

    for tool, text in entries:
        if not text:
            continue
        for m in _IRI_RE.finditer(text):
            iri = _clean(m.group(0))
            add(iri, tool, iri=iri)
        for m in _JCI_RE.finditer(text):
            jci = _clean(m.group(0))
            add(jci, tool, jci=jci)
        # Kale BWB-id's alleen als vindplaats als ze niet al in een IRI/jci zitten.
        for m in _BWB_RE.finditer(text):
            bwb = m.group(0)
            if any(bwb in u for u in seen):
                continue
            add(bwb, tool)

    return sources
