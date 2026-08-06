"""Artikeltekst uit de graaf: numerieke lid-sortering, citeertitel, artikeltekst-fallback."""
from __future__ import annotations

import json

from agent.artikel import artikel_corpus, haal_artikel_sync
from fakes import FakeGraph


def test_decimaal_nummer_valt_terug_op_get_bepaling():
    # get_artikel weigert "9.1" (ValueError) → fallback op get_bepaling (bwb:nummer).
    bep = json.dumps('?nummer\t?tekst\t?label\n"9.1"\t"Afwijking van de betalingstermijnen."@nl\t"Afwijking"')

    class G:
        def sparql(self, q):
            return bep if "bwb:nummer" in q else ""  # get_bepaling ⇄ (get_regeling_info → leeg)

        def initialize(self):
            return {}

        def close(self):
            pass

    data = haal_artikel_sync("BWBR0024096", "9.1", G())
    assert data["leden_teksten"] == [{"lid": "", "tekst": "Afwijking van de betalingstermijnen."}]

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


def test_haal_artikel_lid_scoping():
    data = haal_artikel_sync("BWBR0004770", "9", FakeGraph(results=_results), lid="2")
    assert [ld["lid"] for ld in data["leden_teksten"]] == ["2"]
    assert data["corpus"] == "2. Tweede lid."


def test_corpus_lid_scoping_1_niet_10():
    # '1' mag niet ook lid '10' matchen (numerieke vergelijking, geen prefix).
    assert artikel_corpus("BWBR0004770", "9", FakeGraph(results=_results), lid="1") == "1. Eerste lid."


def test_corpus_zonder_leden_valt_terug_op_artikeltekst():
    tsv = '?tekst\t?jci\t?lid\t?lidnummer\t?lidtekst\n"De hele artikeltekst."@nl\t"jci"\t\t\t'
    assert artikel_corpus("BWBR0000001", "1", FakeGraph(result=tsv)) == "De hele artikeltekst."


def test_niet_bestaand_lid_geeft_leeg_geen_bepaling_fallback():
    # Een gevraagd lid dat niet bestaat → leeg; NIET terugvallen op de hele bepaling, ook al zou
    # get_bepaling tekst opleveren. (De decimale get_bepaling-fallback geldt alleen zónder lid.)
    BEPALING_TSV = '?nummer\t?tekst\t?label\t?jci\n"9"\t"Volledige bepalingstekst."@nl\t"Art. 9"\t"jci"'

    def results(query: str) -> str:
        if "citeertitel" in query:
            return REGELING_TSV
        if "heeftLid" in query:  # get_artikel: leden 1, 2, 10
            return ARTIKEL_TSV
        return BEPALING_TSV      # get_bepaling zou hier tekst geven — mag NIET gebruikt worden

    data = haal_artikel_sync("BWBR0004770", "9", FakeGraph(results=results), lid="5")
    assert data["leden_teksten"] == []
    assert data["corpus"] == ""
    # Ter contrast: zónder lid werkt de gewone leden-weergave nog gewoon.
    heel = haal_artikel_sync("BWBR0004770", "9", FakeGraph(results=results))
    assert [ld["lid"] for ld in heel["leden_teksten"]] == ["1", "2", "10"]
