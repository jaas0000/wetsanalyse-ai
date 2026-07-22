"""
Pydantic-modellen voor request/response van de graph-qa API.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ChatRequest(BaseModel):
    question: str
    conversation_id: str | None = None  # stuur mee voor gespreksgeheugen


class Source(BaseModel):
    label: str
    uri: str
    # Herkomst-velden (additief; de frontend-BFF leest alleen label + uri).
    iri: str | None = None
    jci: str | None = None
    origin_tool: str | None = None


# SSE-events
class TokenEvent(BaseModel):
    type: Literal["token"] = "token"
    content: str


class SourcesEvent(BaseModel):
    type: Literal["sources"] = "sources"
    sources: list[Source]


class GroundingEvent(BaseModel):
    type: Literal["grounding"] = "grounding"
    grounded: bool
    cited: int = 0
    unsupported: list[str] = []


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


# --- Annotatie (JAS) ---------------------------------------------------------

class AnnotatieAlternatief(BaseModel):
    """Een kandidaat-klasse bij twijfel, met korte motivatie (disambiguatie)."""

    klasse: str
    motivatie: str = ""


class AnnotatieVoorstel(BaseModel):
    """Eén door de agent voorgesteld JAS-annotatie-element voor een artikel.

    `tekst` is een letterlijk fragment uit de artikeltekst; `span`/`grounded`/`vindplaats` worden
    server-side ingevuld door de brongetrouwheid-check (nooit door het model).
    """

    klasse: str
    tekst: str
    lid: str = ""
    toelichting: str = ""
    alternatieven: list[AnnotatieAlternatief] = []
    span: list[int] | None = None      # [start, end] in de (genormaliseerde) artikeltekst
    grounded: bool = False
    vindplaats: str = ""               # bwbId/artikel/lid/jci-notatie


# --- Artikeltekst uit de graaf (workbench-documentpaneel) ---------------------

class LidTekst(BaseModel):
    lid: str = ""
    tekst: str = ""


class ArtikelResult(BaseModel):
    """Artikeltekst uit de graaf voor het workbench-documentpaneel (weergave == annotatie-corpus)."""

    bwbId: str
    artikel: str
    citeertitel: str = ""
    opschrift: str = ""
    leden_teksten: list[LidTekst] = []
