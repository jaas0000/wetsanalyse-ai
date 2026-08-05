"""Tests voor WS4 — promotie van een act-2-analyse naar de JAS-annotatielaag in GraphDB.

Draait zonder netwerk via een FakeGraphWrite (de `GraphWritePort`); de echte SPARQL-UPDATE-client
wordt alleen op zijn fail-closed-gedrag getest."""

from __future__ import annotations

import pytest

from app import graph_write
from app.config import Settings
from app.graph_write import GraphDBWriteClient, GraphWriteError, bouw_jas_triples, promoveer


class FakeGraphWrite:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def replace_graph(self, graph_iri: str, triples: str) -> None:
        self.calls.append((graph_iri, triples))


_RAPPORT = {
    "werkgebied": {"naam": "Test"},
    "bronnen": [
        {"bron_id": "br1", "bwbId": "BWBR9999999", "artikel": "1", "lid": "1",
         "markeringen": [
             {"id": "m1", "klasse": "Rechtssubject", "formulering": "De belastingplichtige",
              "vindplaats": "lid 1", "toelichting": "drager"},
             {"id": "m2", "klasse": "Rechtsbetrekking", "formulering": "doet aangifte", "vindplaats": "lid 1"},
         ]},
        {"bron_id": "br2", "bwbId": "BWBR0000002", "artikel": "9.1",  # decimaal → geen bepaling-IRI
         "markeringen": [{"id": "m3", "klasse": "Voorwaarde", "formulering": "indien", "vindplaats": ""}]},
    ],
}


def test_bouw_triples_vorm_en_telling():
    triples, s = bouw_jas_triples(_RAPPORT, "test-slug", prefix="https://ipalm.nl/jas/")
    assert s["aantal"] == 3
    assert s["klassen"] == {"Rechtssubject": 1, "Rechtsbetrekking": 1, "Voorwaarde": 1}
    # Annotatie-IRI's zijn stabiel (idempotentie); literals + klasse aanwezig.
    assert "<https://ipalm.nl/jas/test-slug/br1/m1>" in triples
    assert '<https://ipalm.nl/ns/jas#klasse> "Rechtssubject"' in triples
    assert '<https://ipalm.nl/ns/jas#formulering> "De belastingplichtige"' in triples
    # Artikel/lid met kaal nummer → overBepaling-IRI naar de bestaande graaf-node.
    assert "<https://ipalm.nl/ns/jas#overBepaling> <https://ipalm.nl/bwb/BWBR9999999/artikel/1/lid/1>" in triples
    # Decimaal artikel (9.1) → geen overBepaling-IRI, maar wél de bwbId/artikel-literals.
    assert '<https://ipalm.nl/ns/jas#artikel> "9.1"' in triples
    assert "artikel/9.1" not in triples


def test_triples_escapen_quotes():
    rapport = {"bronnen": [{"bron_id": "b", "bwbId": "BWBR1", "artikel": "1",
               "markeringen": [{"id": "m1", "klasse": "Object", "formulering": 'een "aanslag"'}]}]}
    triples, _ = bouw_jas_triples(rapport, "s", prefix="https://ipalm.nl/jas/")
    assert '\\"aanslag\\"' in triples   # dubbele quote geëscaped, breekt de SPARQL-literal niet


async def test_promoveer_replace_named_graph():
    port = FakeGraphWrite()
    s = await promoveer(port, _RAPPORT, "test-slug", prefix="https://ipalm.nl/jas/")
    assert len(port.calls) == 1
    giri, triples = port.calls[0]
    assert giri == "https://ipalm.nl/jas/test-slug"
    assert s["graph_iri"] == giri and s["aantal"] == 3
    assert "gepromoveerd_op" in s


async def test_promoveer_idempotent():
    """Twee keer promoveren = twee keer dezelfde named-graph-replace (geen accumulatie)."""
    port = FakeGraphWrite()
    await promoveer(port, _RAPPORT, "slug", prefix="https://ipalm.nl/jas/")
    await promoveer(port, _RAPPORT, "slug", prefix="https://ipalm.nl/jas/")
    # Beide calls schrijven exact dezelfde annotatie-IRI's (stabiel) naar dezelfde graaf.
    assert port.calls[0][0] == port.calls[1][0]
    assert "test-slug" not in port.calls[0][1]  # geen slug-lek van een andere test
    assert port.calls[0][1].count("<https://ipalm.nl/ns/jas#Annotatie>") == 3


async def test_write_client_fail_closed():
    """Zonder GRAPHDB_WRITE_TOKEN/GRAPHDB_UPDATE_URL faalt de promotie helder (opt-in)."""
    client = GraphDBWriteClient(Settings())
    with pytest.raises(GraphWriteError, match="niet geconfigureerd"):
        await client.replace_graph("https://ipalm.nl/jas/x", "<a> <b> <c> .")


async def test_engine_promoveer(settings, store):
    """De engine leest het rapport en promoveert via de geïnjecteerde schrijfpoort."""
    from app.contracts import Job, JobState
    from app.engine.orchestrator import WetsanalyseEngine
    from conftest import FakeLLM, FakeWettenbank

    port = FakeGraphWrite()
    engine = WetsanalyseEngine(settings, store, FakeLLM(), FakeWettenbank(), None, port)
    await store.save_job(Job(id="p1", state=JobState.klaar, client_id="c1"))
    await store.schrijf_rapport("p1", _RAPPORT)

    s = await engine.promoveer("p1")
    assert s["aantal"] == 3 and len(port.calls) == 1
    assert port.calls[0][0] == f"{settings.jas_graph_prefix}p1"
