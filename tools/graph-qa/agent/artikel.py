"""Gestructureerde artikeltekst uit de graaf.

Eén bron voor zowel de **weergave** (documentpaneel in de workbench) als de **annotatie-corpus**: beide
komen uit `queries.get_artikel` op GraphDB, geparseerd via `parse_select`. Zo is er geen drift tussen
wat de jurist ziet en waartegen de brongetrouwheid van de agent wordt gecheckt.
"""
from __future__ import annotations

import logging
import re

from .graph import queries
from .graph.results import parse_select
from .ports import GraphPort

logger = logging.getLogger("graph_qa.artikel")

_NUM = re.compile(r"\d+")


def _lidsleutel(lid: str) -> tuple[int, str]:
    """Numeriek sorteren op lidnummer (de SPARQL ORDER BY ?lid is lexicaal: 1,10,11,2,…)."""
    m = _NUM.search(lid or "")
    return (int(m.group()) if m else 10**9, lid or "")


def _match_lid(lidnummer: str, lid: str) -> bool:
    """Vergelijk lidnummers robuust ('1' == '01'); valt terug op string-gelijkheid."""
    a, b = _lidsleutel(lidnummer), _lidsleutel(lid)
    if a[0] != 10**9 and b[0] != 10**9:
        return a[0] == b[0]
    return (lidnummer or "").strip() == (lid or "").strip()


def _leden_en_corpus(bwb_id: str, artikel: str, graph: GraphPort, lid: str | None = None) -> tuple[list[dict], str]:
    """(leden_teksten, corpus) uit de graaf. Corpus = de leden samengevoegd ('N. tekst'),
    of de artikeltekst zelf als er geen genummerde leden zijn. Met `lid` scope je tot dat ene lid."""
    rows = parse_select(graph.sparql(queries.get_artikel(bwb_id, artikel)))
    art_tekst = next((r["tekst"] for r in rows if r.get("tekst")), "")
    leden: list[dict] = []
    for r in rows:
        tekst = (r.get("lidtekst") or "").strip()
        if tekst:
            leden.append({"lid": (r.get("lidnummer") or "").strip(), "tekst": tekst})
    leden.sort(key=lambda ld: _lidsleutel(ld["lid"]))
    if lid and str(lid).strip():
        leden = [ld for ld in leden if _match_lid(ld["lid"], str(lid))]
    elif not leden and art_tekst.strip():
        leden = [{"lid": "", "tekst": art_tekst.strip()}]
    corpus = "\n\n".join((f'{ld["lid"]}. {ld["tekst"]}' if ld["lid"] else ld["tekst"]) for ld in leden)
    return leden, corpus


def artikel_corpus(bwb_id: str, artikel: str, graph: GraphPort, lid: str | None = None) -> str:
    """Alleen de corpus-tekst (voor de annotatie-flow; één SPARQL, geen regeling-info)."""
    return _leden_en_corpus(bwb_id, artikel, graph, lid)[1]


def haal_artikel_sync(bwb_id: str, artikel: str, graph: GraphPort, lid: str | None = None) -> dict:
    """Volledige artikelinfo voor de workbench-weergave: leden-teksten + citeertitel + corpus.
    Met `lid` beperk je de weergave tot dat ene lid."""
    leden, corpus = _leden_en_corpus(bwb_id, artikel, graph, lid)
    citeertitel = ""
    try:
        info = parse_select(graph.sparql(queries.get_regeling_info(bwb_id)))
        if info:
            citeertitel = (info[0].get("citeertitel") or "").strip()
    except Exception:  # citeertitel is cosmetisch — nooit de artikeltekst blokkeren
        logger.warning("citeertitel ophalen mislukt", exc_info=True)
    return {
        "bwbId": bwb_id,
        "artikel": artikel,
        "citeertitel": citeertitel,
        "opschrift": "",
        "leden_teksten": leden,
        "corpus": corpus,
    }
