"""Artikeltekst uit de graaf: numerieke lid-sortering, citeertitel, artikeltekst-fallback."""
from __future__ import annotations

from agent.artikel import artikel_corpus, haal_artikel_sync
from fakes import FakeGraph

ARTIKEL_TSV = (
    "?tekst\t?jci\t?lid\t?lidnummer\t?lidtekst\n"
    '\t"jci"\t<https://ipalm.nl/bwb/X/artikel/9/lid/1>\t"1"\t"Eerste lid."@nl\n'
    '\t"jci"\t<https://ipalm.nl/bwb/X/artikel/9/lid/10>\t"10"\t"Tiende lid."@nl\n'
    '\t"jci"\t<https://ipalm.nl/bwb/X/artikel/9/lid/2>\t"2"\t"Tweede lid."@nl'
)
REGELING_TSV = '?citeertitel\t?opschrift\t?afkorting\t?soort\n"Invorderingswet 1990"\t""\t"IW"\t"wet"'


def _results(query: str) -> str:
    # get_regeling_info vraagt ?citeertitel; get_artikel vraagt de leden op.
    return REGELING_TSV if "citeertitel" in query else ARTIKEL_TSV


def test_haal_artikel_sorteert_numeriek_en_leest_citeertitel():
    data = haal_artikel_sync("BWBR0004770", "9", FakeGraph(results=_results))
    assert [ld["lid"] for ld in data["leden_teksten"]] == ["1", "2", "10"]  # numeriek, niet lexicaal
    assert data["citeertitel"] == "Invorderingswet 1990"
    assert data["corpus"].startswith("1. Eerste lid.")
    assert "10. Tiende lid." in data["corpus"]


def test_corpus_zonder_leden_valt_terug_op_artikeltekst():
    tsv = '?tekst\t?jci\t?lid\t?lidnummer\t?lidtekst\n"De hele artikeltekst."@nl\t"jci"\t\t\t'
    assert artikel_corpus("BWBR0000001", "1", FakeGraph(result=tsv)) == "De hele artikeltekst."
