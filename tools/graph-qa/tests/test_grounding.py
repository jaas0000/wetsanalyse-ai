"""PR 2.1: grounding-verificatie en bron-curatie."""
from __future__ import annotations

from agent.grounding import check_grounding, curate_sources
from agent.models import Source
from agent.provenance import citations_in, iter_refs

IW = "https://ipalm.nl/bwb/BWBR0004770/artikel/9"
LEIDRAAD = "https://ipalm.nl/bwb/BWBR0024096/artikel/26"


def _trace(text: str):
    return [("get_artikel", text)]


def test_citatie_in_trace_is_grounded():
    answer = "Zie artikel 9 van de Invorderingswet 1990 (BWBR0004770)."
    report = check_grounding(answer, _trace(f"<{IW}> bwb:tekst '...' ."))
    assert report.grounded is True
    assert report.unsupported == []


def test_verzonnen_citatie_wordt_gemarkeerd():
    answer = "Zie de niet-bestaande regeling BWBR9999999."
    report = check_grounding(answer, _trace(f"<{IW}>"))
    assert report.grounded is False
    assert any("BWBR9999999" in u for u in report.unsupported)


def test_grounding_op_bwb_granulariteit_geen_vals_alarm():
    # Antwoord noemt een jci met afwijkende opmaak; BWB-id staat wél in de trace → geen alarm.
    answer = "Vindplaats: jci1.3:c:BWBR0004770&artikel=9&lid=1"
    report = check_grounding(answer, _trace("resultaat met BWBR0004770 erin"))
    assert report.grounded is True


def test_curate_beperkt_tot_genoemde_regeling():
    sources = [
        Source(label=IW, uri=IW),
        Source(label=LEIDRAAD, uri=LEIDRAAD),
    ]
    answer = "Alleen de Invorderingswet 1990 (BWBR0004770) is relevant."
    kept = curate_sources(sources, answer)
    uris = [s.uri for s in kept]
    assert IW in uris
    assert LEIDRAAD not in uris  # niet genoemde regeling valt weg


def test_curate_valt_terug_op_alles_zonder_bwb_in_antwoord():
    sources = [Source(label=IW, uri=IW)]
    kept = curate_sources(sources, "Een antwoord zonder enig BWB-id.")
    assert kept == sources


def test_jci_backslash_wordt_gestript():
    text = r'"jci1.3:c:BWBR0004770&artikel=9&z=2026-07-01\ " staat hier'
    uris = [uri for uri, _, jci in iter_refs(text) if jci]
    assert uris
    assert not any(u.endswith("\\") for u in uris)


def test_citations_in_negeert_vocabulaire_namespace():
    assert citations_in("?s <https://ipalm.nl/ns/bwb#heeftLid> ?o") == []
