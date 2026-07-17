"""WP-B: read-only vangnet weigert SPARQL-updates, laat SELECT door."""
from __future__ import annotations

import pytest

from agent.mcp_client import MCPClient, MCPError, _looks_like_update

UPDATES = [
    "INSERT DATA { <a> <b> <c> }",
    "DELETE WHERE { ?s ?p ?o }",
    "DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }",
    "DROP GRAPH <http://x>",
    "CLEAR ALL",
    "LOAD <http://x>",
    "PREFIX ex: <http://x#>\nINSERT DATA { ex:a ex:b ex:c }",
]

BENIGN = [
    "SELECT ?s WHERE { ?s ?p ?o } LIMIT 10",
    'SELECT ?t WHERE { ?s bwb:tekst ?t FILTER(CONTAINS(LCASE(?t), "delete")) }',
    "PREFIX bwb: <https://ipalm.nl/ns/bwb#>\nSELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a bwb:Regeling }",
    "ASK { ?s ?p ?o }",
]


@pytest.mark.parametrize("q", UPDATES)
def test_updates_herkend(q):
    assert _looks_like_update(q) is True


@pytest.mark.parametrize("q", BENIGN)
def test_benigne_queries_niet_herkend(q):
    assert _looks_like_update(q) is False


def test_reject_updates_gooit_mcperror():
    with pytest.raises(MCPError):
        MCPClient._reject_updates({"query": "INSERT DATA { <a> <b> <c> }"})


def test_reject_updates_laat_select_door():
    # Mag geen exception geven.
    MCPClient._reject_updates({"query": "SELECT ?s WHERE { ?s ?p ?o }"})
