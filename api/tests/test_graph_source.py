"""Tests voor de GraphDB-act-2-bronlaag: SPARQL-bouwers/parser, de bron-basis en de dekking-preflight.

Draait zonder netwerk via een FakeGraph die per query-vorm een SPARQL-TSV teruggeeft (gespiegeld op
`tools/graph-qa/tests/fakes.py`)."""

from __future__ import annotations

import pytest

from app import graph_queries as q
from app import graph_source as gs
from app.graphdb import GraphDBClient, GraphDBError


# --- FakeGraph ----------------------------------------------------------------

class FakeGraph:
    """Herkent de query aan kenmerkende substrings en levert een passende TSV terug."""

    def __init__(self, *, leden=True, verwijzingen=True, dekking_aantal=2) -> None:
        self.leden = leden
        self.verwijzingen = verwijzingen
        self.dekking_aantal = dekking_aantal
        self.queries: list[str] = []

    async def sparql(self, query: str) -> str:
        self.queries.append(query)
        if "COUNT(?t)" in query:
            return f"?aantal\n{self.dekking_aantal}"
        if "bwb:citeertitel ?citeertitel" in query:
            return '?citeertitel\t?opschrift\t?afkorting\t?soort\t?versiedatum\n"Testwet"\t\t\t\t"2026-01-01"'
        if "bwb:heeftVerwijzing" in query:
            if not self.verwijzingen:
                return "?ankerTekst\t?naar\t?soort\t?doelSoort"
            return ('?ankerTekst\t?naar\t?soort\t?doelSoort\n'
                    '"artikel 2"\t<https://ipalm.nl/bwb/BWBR0000001/artikel/2>\t"intref"\t"artikel"')
        if "bwb:heeftLid ?lid" in query:  # get_artikel
            if not self.leden:
                return "?tekst\t?jci\t?lid\t?lidnummer\t?lidtekst"
            return ('?tekst\t?jci\t?lid\t?lidnummer\t?lidtekst\n'
                    '\t"jci1.3:c:BWBR9999999&artikel=1"\t<https://ipalm.nl/bwb/BWBR9999999/artikel/1/lid/1>'
                    '\t"1"\t"De belastingplichtige doet aangifte."\n'
                    '\t"jci1.3:c:BWBR9999999&artikel=1"\t<https://ipalm.nl/bwb/BWBR9999999/artikel/1/lid/2>'
                    '\t"2"\t"De inspecteur stelt de aanslag vast."')
        return ""


# --- parse_select -------------------------------------------------------------

def test_parse_select_iri_en_literal():
    tsv = '?a\t?b\n<https://x/1>\t"hallo wereld"'
    rows = q.parse_select(tsv)
    assert rows == [{"a": "https://x/1", "b": "hallo wereld"}]


def test_parse_select_json_string_encoded():
    # De GraphDB-MCP levert de TSV als JSON-string (buitenste quotes + \t/\n-escapes).
    tsv = '"?n\\n\\"5\\""'
    assert q.parse_select(tsv) == [{"n": "5"}]


def test_parse_select_leeg():
    assert q.parse_select("") == []
    assert q.parse_select("?a\t?b") == []  # alleen header


# --- SPARQL-bouwers valideren invoer -----------------------------------------

def test_query_bouwers_valideren_ids():
    assert "BWBR9999999/artikel/1" in q.get_artikel("BWBR9999999", "1")
    with pytest.raises(ValueError):
        q.get_artikel("nietbwb", "1")
    with pytest.raises(ValueError):
        q.artikel_iri("BWBR1", "1; DROP")
    # Decimale artikelnummers gaan via get_bepaling (nummer-patroon), niet get_artikel.
    assert 'bwb:nummer "9.1"' in q.get_bepaling("BWBR1", "9.1")


# --- bron-basis ---------------------------------------------------------------

async def test_haal_bron_basis_vorm():
    g = FakeGraph()
    basis = await gs.haal_bron_basis(g, "br1", "BWBR9999999", "1")
    assert basis["bron_id"] == "br1"
    assert basis["wet"] == "Testwet"
    assert basis["bwbId"] == "BWBR9999999" and basis["artikel"] == "1"
    assert basis["bronreferentie"] == "jci1.3:c:BWBR9999999&artikel=1"
    assert basis["versiedatum"] == "2026-01-01"
    assert [ld["lid"] for ld in basis["leden"]] == ["1", "2"]
    assert basis["leden"][0]["tekst"] == "De belastingplichtige doet aangifte."
    assert basis["label"] == "Testwet art. 1"
    assert basis["graph_verwijzingen"][0]["naar"].endswith("/artikel/2")


async def test_haal_bron_basis_lid_scoping():
    g = FakeGraph()
    basis = await gs.haal_bron_basis(g, "br1", "BWBR9999999", "1", lid="2")
    assert [ld["lid"] for ld in basis["leden"]] == ["2"]
    assert basis["label"] == "Testwet art. 1 lid 2"


async def test_haal_bron_basis_verwijzingen_optioneel():
    g = FakeGraph(verwijzingen=False)
    basis = await gs.haal_bron_basis(g, "br1", "BWBR9999999", "1")
    assert basis["graph_verwijzingen"] == []
    assert basis["leden"]  # leden nog steeds gevuld


# --- dekking-preflight --------------------------------------------------------

async def test_is_gedekt():
    assert await gs.is_gedekt(FakeGraph(dekking_aantal=2), "BWBR9999999", "1") is True
    assert await gs.is_gedekt(FakeGraph(dekking_aantal=0), "BWBR9999999", "1") is False


# --- read-only guard (geen netwerk) -------------------------------------------

async def test_graphdb_weigert_update():
    from app.config import Settings
    client = GraphDBClient(Settings())
    with pytest.raises(GraphDBError):
        await client.sparql("INSERT DATA { <a> <b> <c> }")
    with pytest.raises(GraphDBError):
        await client.sparql("DELETE WHERE { ?s ?p ?o }")
