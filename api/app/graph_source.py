"""Brongetrouwe act-2-basis uit GraphDB — vervangt de wettenbank-MCP-bronophaal in de act-2-flow.

Per bron `(bwbId, artikel, lid?)` levert dit de velden die het LLM **niet** mag verzinnen: de
leden-tekst (= brongetrouw corpus voor de harde gate), de jci/bronreferentie, de regeling-/wet-naam
en de uitgaande verwijzingen. De vorm is gelijk aan `wettenbank.map_artikel_naar_bron_basis`, zodat
het een drop-in is voor `orchestrator._fase_start` en de bestaande merge.

Logica gespiegeld op `tools/graph-qa/agent/artikel.py` (`_leden_en_corpus`); queries in `graph_queries`.
"""

from __future__ import annotations

import re

from . import graph_queries as q
from .graphdb import GraphDBClient

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


async def _bepaling_fallback(client: GraphDBClient, bwb_id: str, artikel: str) -> tuple[list[dict], str]:
    """Beleidsregels/circulaires (decimale nummers zoals '9.1') gaan niet via het artikel/lid-IRI-
    patroon; haal ze via `bwb:nummer` (get_bepaling)."""
    try:
        rows = q.parse_select(await client.sparql(q.get_bepaling(bwb_id, artikel)))
    except ValueError:
        return [], ""
    row = next((r for r in rows if (r.get("tekst") or "").strip()), {})
    tekst = (row.get("tekst") or "").strip()
    jci = (row.get("jci") or "").strip()
    return ([{"lid": "", "tekst": tekst}] if tekst else []), jci


async def _leden_en_jci(
    client: GraphDBClient, bwb_id: str, artikel: str, lid: str | None
) -> tuple[list[dict], str]:
    """(leden, jci) uit de graaf. Met `lid` scope je tot dat ene lid; decimale nummers vallen
    terug op get_bepaling."""
    try:
        rows = q.parse_select(await client.sparql(q.get_artikel(bwb_id, artikel)))
    except ValueError:
        rows = []  # bv. artikel "9.1" wordt door get_artikel geweigerd → bepaling-fallback
    art_tekst = next((r["tekst"] for r in rows if r.get("tekst")), "")
    jci = next((r["jci"] for r in rows if r.get("jci")), "")
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
    if not leden:  # geen artikel/lid-tekst → probeer de bepaling op nummer
        leden, jci = await _bepaling_fallback(client, bwb_id, artikel)
    return leden, jci


async def _regeling_info(client: GraphDBClient, bwb_id: str) -> tuple[str, str]:
    """(citeertitel, versiedatum) — cosmetisch/metadata; nooit de bronophaal blokkeren."""
    try:
        info = q.parse_select(await client.sparql(q.get_regeling_info(bwb_id)))
    except Exception:  # noqa: BLE001
        return "", ""
    if not info:
        return "", ""
    return (info[0].get("citeertitel") or "").strip(), (info[0].get("versiedatum") or "").strip()


async def _verwijzingen(
    client: GraphDBClient, bwb_id: str, artikel: str, lid: str | None
) -> list[dict]:
    """Uitgaande verwijzingen uit de graaf (kandidaten voor de verwijzing-as van act-2)."""
    try:
        rows = q.parse_select(await client.sparql(q.follow_verwijzingen(bwb_id, artikel, lid)))
    except Exception:  # noqa: BLE001 — verwijzingen zijn additief; nooit de bron blokkeren
        return []
    uit: list[dict] = []
    for r in rows:
        naar = (r.get("naar") or "").strip()
        anker = (r.get("ankerTekst") or "").strip()
        if not (naar or anker):
            continue
        uit.append({
            "anker": anker,
            "naar": naar,
            "soort": (r.get("soort") or "").strip(),
            "doelSoort": (r.get("doelSoort") or "").strip(),
        })
    return uit


async def haal_bron_basis(
    client: GraphDBClient, bron_id: str, bwb_id: str, artikel: str,
    lid: str | None = None, label: str = "",
) -> dict:
    """De brongetrouwe basis voor één bron in het werkgebied (vorm = map_artikel_naar_bron_basis).

    De `leden`-tekst is het brongetrouw corpus waartegen `validation.brongetrouwheid_check` de
    markeringen letterlijk toetst. `graph_verwijzingen` voedt de verwijzing-as van de agent-worker.
    """
    leden, jci = await _leden_en_jci(client, bwb_id, artikel, lid)
    citeertitel, versiedatum = await _regeling_info(client, bwb_id)
    verwijzingen = await _verwijzingen(client, bwb_id, artikel, lid)
    wet = citeertitel or bwb_id
    if not label:
        lid_str = f" lid {lid}" if lid else ""
        label = f"{wet} art. {artikel}{lid_str}".strip()
    return {
        "bron_id": bron_id,
        "label": label,
        "lid": lid,
        "wet": citeertitel,
        "bwbId": bwb_id,
        "artikel": str(artikel),
        "versiedatum": versiedatum,
        "bronreferentie": jci,
        "pad": "",
        "leden": leden,
        "graph_verwijzingen": verwijzingen,
    }


async def is_gedekt(client: GraphDBClient, bwb_id: str, artikel: str) -> bool:
    """Dekkings-preflight: staat er tekst voor dit (bwbId, artikel) in de graaf?"""
    try:
        rows = q.parse_select(await client.sparql(q.dekking(bwb_id, artikel)))
    except (ValueError, Exception):  # noqa: BLE001
        return False
    if not rows:
        return False
    try:
        return int((rows[0].get("aantal") or "0")) > 0
    except (TypeError, ValueError):
        return False
