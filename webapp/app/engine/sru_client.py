"""SRU-client voor zoekservice.overheid.nl.

Herschreven uit tools/wettenbank-mcp/src/clients/sru-client.ts (TypeScript).
Haalt regelingen op via de publieke SRU-API van overheid.nl.
Geen API-key nodig — data is CC-0.
"""

import httpx
from lxml import etree
from app.models import Regeling

SRU_BASE = "https://zoekservice.overheid.nl/sru/Search"
FETCH_TIMEOUT = 15  # seconden


def _el_text(parent: etree._Element | None, tag: str) -> str:
    """Haal tekst uit een child-element (namespace-aware)."""
    if parent is None:
        return ""
    # Probeer eerst met namespace, dan zonder
    for ns in [None, "*"]:
        if ns:
            el = parent.find(f"{{{ns}}}{tag}")
        else:
            el = parent.find(tag)
        if el is not None and el.text:
            return el.text.strip()
    return ""


def _attr(el: etree._Element | None, attr: str) -> str:
    if el is None:
        return ""
    return el.get(attr, "")


def strip_xml(xml: str) -> str:
    """Verwijder XML-tags en retourneer platte tekst."""
    root = etree.fromstring(xml.encode())
    return " ".join(root.itertext()).strip()


async def sru_request(query: str, max_records: int = 10) -> str:
    """Voer een SRU-zoekopdracht uit en retourneer de XML-response."""
    params = {
        "operation": "searchRetrieve",
        "version": "2.0",
        "x-connection": "BWB",
        "query": query,
        "maximumRecords": str(max_records),
    }
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
        resp = await client.get(SRU_BASE, params=params, headers={"Accept": "application/xml"})
        resp.raise_for_status()
        return resp.text


def parse_records(xml: str) -> list[Regeling]:
    """Parseer SRU XML-response naar een lijst Regeling-objecten."""
    root = etree.fromstring(xml.encode())
    records = root.findall(".//record")
    result = []

    for rec in records:
        gzd = rec.find("gzd")
        if gzd is None:
            continue

        owmskern = gzd.find("owmskern")
        bwbipm = gzd.find("bwbipm")
        enrich = gzd.find("enrichedData")

        bwb_id = _el_text(owmskern, "dcterms:identifier")

        # Rechtsgebieden (kunnen meerdere zijn)
        rechtsgebieden = []
        if bwbipm is not None:
            for rg in bwbipm.findall(".//overheidbwb:rechtsgebied"):
                if rg.text:
                    rechtsgebieden.append(rg.text.strip())

        # Repository URL
        repo_url = ""
        if enrich is not None:
            loc = enrich.find("overheidbwb:locatie_toestand")
            if loc is not None and loc.text:
                repo_url = loc.text.strip()
        if not repo_url and bwb_id:
            repo_url = f"https://repository.officiele-overheidspublicaties.nl/bwb/{bwb_id}/"

        result.append(Regeling(
            bwb_id=bwb_id,
            titel=_el_text(owmskern, "dcterms:title"),
            type=_el_text(owmskern, "dcterms:type"),
            ministerie=_el_text(owmskern, "overheid:authority"),
            rechtsgebied=", ".join(rechtsgebieden),
            geldig_vanaf=_el_text(bwbipm, "overheidbwb:geldigheidsperiode_startdatum"),
            geldig_tot=_el_text(bwbipm, "overheidbwb:geldigheidsperiode_einddatum") or "onbepaald",
            gewijzigd=_el_text(owmskern, "dcterms:modified"),
            repository_url=repo_url,
        ))

    return result


def dedupliceer_op_bwb_id(regelingen: list[Regeling]) -> list[Regeling]:
    """Verwijder duplicaten op BWB-id, behoud de meest recente."""
    seen: dict[str, Regeling] = {}
    for r in regelingen:
        bestaand = seen.get(r.bwb_id)
        if not bestaand or r.geldig_vanaf > bestaand.geldig_vanaf:
            seen[r.bwb_id] = r
    return list(seen.values())
