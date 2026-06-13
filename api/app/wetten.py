"""Service-laag over de wet-catalogus in MongoDB.

CRUD voor `WetCatalogus` (gebruikt door de admin-router) plus `resolve_naam`: haal de officiële
citeertitel van een wet op via de MCP (`wettenbank_structuur`, vereist alleen een BWB-id), zodat de
beheer-UI de naam kan voorstellen. De catalogus is bewust niet-dwingend: hij valideert geen
analyses, maar levert alleen de keuzelijst voor de frontend-dropdown.
"""

from __future__ import annotations

from .config import Settings, get_settings
from .wet_catalog import WetCatalogus, _utcnow
from .wettenbank import WettenbankClient, WettenbankError


class WetError(ValueError):
    """Ongeldige catalogus-operatie (onbekende wet, e.d.)."""


# --- lezen ---------------------------------------------------------------------

async def list_wetten() -> list[WetCatalogus]:
    return await WetCatalogus.find_all().sort("naam").to_list()


async def get_wet(bwb_id: str) -> WetCatalogus | None:
    return await WetCatalogus.find_one(WetCatalogus.bwbId == bwb_id)


# --- muteren -------------------------------------------------------------------

async def upsert_wet(bwb_id: str, *, naam: str, updated_by: str) -> WetCatalogus:
    """Maak of werk een catalogus-item bij (de BWB-id is de sleutel)."""
    wet = await get_wet(bwb_id)
    if wet is None:
        wet = WetCatalogus(bwbId=bwb_id)
    wet.naam = naam
    wet.updated_by = updated_by
    wet.updated = _utcnow()
    await wet.save()
    return wet


async def delete_wet(bwb_id: str) -> None:
    wet = await get_wet(bwb_id)
    if wet is None:
        raise WetError(f"Onbekende wet: {bwb_id!r}")
    await wet.delete()


# --- MCP-naamresolutie ---------------------------------------------------------

async def resolve_naam(bwb_id: str, settings: Settings | None = None) -> str:
    """Haal de officiële citeertitel op via de MCP. Werpt WettenbankError bij een mis."""
    s = settings or get_settings()
    data = await WettenbankClient(s).structuur(bwb_id)
    naam = data.get("citeertitel") or ""
    if not naam:
        raise WettenbankError(f"Geen citeertitel gevonden voor {bwb_id}")
    return naam
