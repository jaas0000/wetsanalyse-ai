"""WP-D: de SPARQL-bouwers produceren de juiste patronen en valideren invoer."""
from __future__ import annotations

import pytest

from agent.graph import queries as q


def test_fts_gebruikt_lucene_en_limit():
    sparql = q.fts("invordering AND belasting", 5)
    assert "inst:bwb_tekst" in sparql
    assert 'luc:query "invordering AND belasting"' in sparql
    assert "LIMIT 5" in sparql


def test_fts_limit_wordt_begrensd():
    assert "LIMIT 50" in q.fts("x", 999)
    assert "LIMIT 1" in q.fts("x", 0)


def test_list_regelingen_filtert_eigen_iri_ruimte():
    sparql = q.list_regelingen()
    assert "a bwb:Regeling" in sparql
    assert 'STRSTARTS(STR(?regeling), "https://ipalm.nl/bwb/")' in sparql


def test_get_artikel_bouwt_iri_en_leden():
    sparql = q.get_artikel("BWBR0004770", "9")
    assert "<https://ipalm.nl/bwb/BWBR0004770/artikel/9>" in sparql
    assert "bwb:heeftLid" in sparql


def test_get_lid_iri():
    assert "<https://ipalm.nl/bwb/BWBR0004770/artikel/9/lid/1>" in q.get_lid("BWBR0004770", "9", "1")


def test_verwijzingen_met_en_zonder_lid():
    met = q.follow_verwijzingen("BWBR0004770", "9", "1")
    assert "/artikel/9/lid/1>" in met and "bwb:heeftVerwijzing" in met
    zonder = q.follow_verwijzingen("BWBR0004770", "9")
    assert "/artikel/9>" in zonder and "/lid/" not in zonder


def test_referenced_by_gebruikt_verwijzingdoor():
    assert "bwb:verwijzingDoor" in q.referenced_by("BWBR0004770", "9")


def test_count_by_type():
    sparql = q.count_by_type()
    assert "COUNT(DISTINCT ?s)" in sparql
    assert "STRSTARTS" in sparql


def test_resolve_begrip_escapet_term():
    # Een aanhalingsteken in de term mag de query niet breken.
    sparql = q.resolve_begrip('dwang"bevel')
    assert '\\"' in sparql
    assert "skos:prefLabel" in sparql


@pytest.mark.parametrize("bad", ["DROP", "BWBR", "', DELETE", "0004770"])
def test_ongeldig_bwb_id_wordt_geweigerd(bad):
    with pytest.raises(ValueError):
        q.get_regeling_info(bad)


@pytest.mark.parametrize("bad", ["9; DROP", "../x", "9 9"])
def test_ongeldig_artikel_wordt_geweigerd(bad):
    with pytest.raises(ValueError):
        q.get_artikel("BWBR0004770", bad)
