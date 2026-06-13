"""Beanie Document voor een wet in de selecteerbare catalogus (BWB-id + leesbare naam).

De catalogus is een gemak voor de UI: het analyseformulier toont een dropdown van geregistreerde
wetten zodat je geen rauwe BWB-id hoeft in te typen. Hij is *niet* dwingend — een willekeurige
BWB-id blijft toegestaan (de orchestrator dwingt geen catalogus-lidmaatschap af). De wet-*naam*
in het eindrapport komt los hiervan uit de MCP (`citeertitel`); deze `naam` is puur een label.

Beheerbaar via /v1/admin/wetten; de niet-admin keuzelijst staat op /v1/wetten.
"""

from __future__ import annotations

from datetime import datetime, timezone

from beanie import Document
from pydantic import Field
from pymongo import ASCENDING, IndexModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class WetCatalogus(Document):
    bwbId: str
    naam: str = ""

    updated_by: str = ""
    created: datetime = Field(default_factory=_utcnow)
    updated: datetime = Field(default_factory=_utcnow)

    def touch(self) -> None:
        self.updated = _utcnow()

    class Settings:
        name = "wet_catalogus"
        indexes = [
            IndexModel([("bwbId", ASCENDING)], unique=True),
        ]
