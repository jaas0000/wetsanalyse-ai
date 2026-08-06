"""
Contracten voor het gesprekken-domein (chat-werkruimte).

De persistente **chatgeschiedenis** van de werkplek: per gebruiker een lijst gesprekken, elk met een
geordende reeks berichten. Bewust **los** van het annotatie-domein: een bericht kan naar een
annotatie-document verwijzen (`annotatie_slug`), maar de review-state zelf blijft in het
annotatie-domein. De berichten dragen de heterogene payload van één chat-beurt (tekst + optioneel
denkproces/bronnen, of een annotatie-verwijzing).
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class Rol(str, Enum):
    user = "user"
    assistant = "assistant"


class Bericht(BaseModel):
    """Eén beurt in het gesprek. Assistent-berichten dragen optioneel `denk`/`bronnen`, of een
    verwijzing naar een annotatie-document (`annotatie_slug` + de Critic-`ontbrekend`-suggesties)."""

    id: int | None = None
    rol: Rol
    tekst: str = ""
    denk: str = ""
    bronnen: list[dict] = []
    annotatie_slug: str = ""
    ontbrekend: list[dict] = []
    created: datetime | None = None


class Gesprek(BaseModel):
    """Eén chat-gesprek van een gebruiker, met zijn berichten."""

    id: str
    user_id: str = ""
    titel: str = ""
    berichten: list[Bericht] = []
    created: datetime | None = None
    updated: datetime | None = None


# --- invoer / uitvoer --------------------------------------------------------

class GesprekCreate(BaseModel):
    titel: str = ""


class GesprekPatch(BaseModel):
    titel: str


class BerichtInvoer(BaseModel):
    rol: Rol
    tekst: str = ""
    denk: str = ""
    bronnen: list[dict] = []
    annotatie_slug: str = ""
    ontbrekend: list[dict] = []


class GesprekSamenvatting(BaseModel):
    """Lichte lijst-weergave voor de sidebar (chatgeschiedenis)."""

    id: str
    titel: str = ""
    aantal_berichten: int = 0
    updated: datetime | None = None
