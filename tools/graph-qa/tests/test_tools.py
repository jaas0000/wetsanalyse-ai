"""WP-D: de registry levert schema's en dispatcht naar de juiste bouwer."""
from __future__ import annotations

from agent import tools
from agent.graph import schema
from fakes import FakeGraph

EXPECTED = {
    "search_wetgeving", "get_artikel", "get_lid", "list_regelingen",
    "get_regeling_info", "follow_verwijzingen", "referenced_by", "get_context",
    "resolve_begrip", "graph_schema", "raw_sparql",
}


def test_schemas_compleet_en_welgevormd():
    schemas = tools.anthropic_schemas()
    namen = {t["name"] for t in schemas}
    assert namen == EXPECTED
    for t in schemas:
        assert t["input_schema"]["type"] == "object"
        assert t["description"]


def test_dispatch_onbekende_tool():
    assert "Onbekende tool" in tools.dispatch("bestaat_niet", FakeGraph(), {})


def test_dispatch_list_regelingen_voert_query_uit():
    g = FakeGraph(result="resultaat")
    out = tools.dispatch("list_regelingen", g, {})
    assert out == "resultaat"
    assert g.queries and "bwb:Regeling" in g.queries[0]


def test_dispatch_get_artikel():
    g = FakeGraph(result="artikel 9")
    out = tools.dispatch("get_artikel", g, {"bwb_id": "BWBR0004770", "artikel": "9"})
    assert out == "artikel 9"
    assert "/artikel/9>" in g.queries[0]


def test_dispatch_vangt_validatiefout_op():
    g = FakeGraph()
    out = tools.dispatch("get_artikel", g, {"bwb_id": "kwaadaardig", "artikel": "9"})
    assert out.startswith("Fout bij tool 'get_artikel'")
    assert not g.queries  # query is nooit uitgevoerd


def test_dispatch_raw_sparql_forwards_query():
    g = FakeGraph(result="rows")
    tools.dispatch("raw_sparql", g, {"query": "SELECT ?s WHERE { ?s ?p ?o }"})
    assert g.queries == ["SELECT ?s WHERE { ?s ?p ?o }"]


def test_dispatch_get_context():
    g = FakeGraph(result="subgraaf")
    out = tools.dispatch("get_context", g, {"bwb_id": "BWBR0004770", "artikel": "9"})
    assert out == "subgraaf"
    q = g.queries[0]
    assert "verwijzingDoor" in q and "heeftVerwijzing" in q and "bwb:bevat" in q
