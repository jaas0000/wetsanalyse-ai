"""Pydantic-contracten — 1-op-1 met de schema's uit references/review-checkpoints.md.

Deze modellen zijn de waarheid voor (de)serialisatie en validatie van de artefacten op disk.
De mechanische JAS-controles zitten in validation.py (hergebruik van de skill-scripts).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Activiteit 2 -------------------------------------------------------------

class Lid(BaseModel):
    lid: str
    tekst: str = ""
    bronreferentie: str = ""


class Markering(BaseModel):
    id: str
    formulering: str = ""
    klasse: str = ""
    vindplaats: str = ""
    toelichting: str = ""
    twijfel: str = ""


class VerwijzingDoel(BaseModel):
    label: str = ""
    target: str = ""   # ruwe JCI/BWB-verwijzing (opaque), indien bekend
    bwbId: str = ""


class Verwijzing(BaseModel):
    """Eén uitgaande verwijzing van de bepaling — zie references/verwijzingen-volgen.md.

    Aparte as náást de markeringen (uitgaande pointers). `volgen` is de fetch-afweging:
    de orchestrator haalt alleen te-volgen verwijzingen daadwerkelijk op (begrensd).
    """

    id: str
    bron_lid: str = ""
    soort: str = ""        # intref | extref | natuurlijk
    functie: str = ""      # definitie | schakel | delegatie | intra-artikel | informatief
    doel: VerwijzingDoel = Field(default_factory=VerwijzingDoel)
    status: str = ""       # opgehaald | gevolgd | gesignaleerd | buiten-scope-diepte
    betekenis: str = ""
    volgen: bool = False    # of de orchestrator de verwezen tekst moet ophalen


class Analyse2(BaseModel):
    wet: str = ""
    bwbId: str = ""
    artikel: str = ""
    versiedatum: str = ""
    bronreferentie: str = ""
    type: str = ""
    pad: str = ""
    analysefocus: str = ""
    reikwijdte: str = ""
    geraadpleegde: str = ""
    leden: list[Lid] = Field(default_factory=list)
    markeringen: list[Markering] = Field(default_factory=list)
    verwijzingen: list[Verwijzing] = Field(default_factory=list)
    samenhang: str = ""


# --- Activiteit 3 -------------------------------------------------------------

class Begrip(BaseModel):
    id: str
    naam: str = ""
    klasse: str = ""
    definitie: str = ""
    voorbeeld: str = ""
    kenmerken: str = ""
    vindplaats: str = ""
    bron_verwijzing: str = ""   # id van de verwijzing waarop het begrip steunt (bv. brondefinitie)
    twijfel: str = ""


class Afleidingsregel(BaseModel):
    id: str
    naam: str = ""
    type: str = ""
    uitvoervariabele: str = ""
    invoervariabelen: str = ""
    parameters: str = ""
    voorwaarden: str = ""
    formulering: str = ""
    vindplaats: str = ""
    twijfel: str = ""


class Analyse3(BaseModel):
    wet: str = ""
    bwbId: str = ""
    artikel: str = ""
    versiedatum: str = ""
    bronreferentie: str = ""
    begrippen: list[Begrip] = Field(default_factory=list)
    afleidingsregels: list[Afleidingsregel] = Field(default_factory=list)
    validatiepunten: list[str] = Field(default_factory=list)


# --- Feedback (door de API geschreven in wacht-op-review-*) -------------------

class Feedback(BaseModel):
    status: Literal["akkoord", "wijzigingen"]
    activiteit: Literal["2", "3"]
    items: dict[str, str] = Field(default_factory=dict)
    algemeen: str = Field(default="", max_length=5000)

    @field_validator("items")
    @classmethod
    def _begrens_items(cls, v: dict[str, str]) -> dict[str, str]:
        # Voorkom ongebonden payloads (opslag-/prompt-kosten): cap aantal en lengte per item.
        if len(v) > 200:
            raise ValueError("te veel feedback-items (max 200)")
        for tekst in v.values():
            if len(tekst) > 2000:
                raise ValueError("feedback-item is te lang (max 2000 tekens)")
        return v

    def is_akkoord_zonder_opmerkingen(self) -> bool:
        return self.status == "akkoord" and not self.items and not self.algemeen.strip()


# --- API-requests -------------------------------------------------------------

class StartRequest(BaseModel):
    bwbId: str | None = Field(default=None, max_length=64)
    wet: str | None = Field(default=None, max_length=256)
    artikel: str = Field(min_length=1, max_length=32)
    lid: str | None = Field(default=None, max_length=16)
    naam: str = Field(default="", max_length=200)
    omschrijving: str = Field(default="", max_length=2000)
    analysefocus: str | None = Field(default=None, max_length=2000)
    review: bool = True
    model_profile: str | None = Field(default=None, max_length=64)


# --- Job-state ----------------------------------------------------------------

class JobState(str, Enum):
    queued = "queued"
    act2_runt = "act2-runt"
    wacht_review_act2 = "wacht-op-review-act2"
    act3_runt = "act3-runt"
    wacht_review_act3 = "wacht-op-review-act3"
    bouwt = "bouwt"
    klaar = "klaar"
    fout = "fout"


RUNNING_STATES = {JobState.act2_runt, JobState.act3_runt, JobState.bouwt}
REVIEW_STATES = {JobState.wacht_review_act2, JobState.wacht_review_act3}
TERMINAL_STATES = {JobState.klaar, JobState.fout}


class FoutKlasse(str, Enum):
    mcp = "mcp"
    llm = "llm"
    validatie = "validatie"
    intern = "intern"
    quota = "quota"


class JobFout(BaseModel):
    stap: str
    ronde: int | None = None
    klasse: FoutKlasse
    bericht: str


class RondeProvenance(BaseModel):
    """Audit per gegenereerde ronde (reproduceerbaarheid)."""

    activiteit: Literal["2", "3"]
    ronde: int
    model: str = ""
    provider: str = ""
    output_strategie: str = ""
    referentie_hash: str = ""
    prompt_hash: str = ""
    mcp_bwbid: str = ""
    mcp_versiedatum: str = ""
    mcp_bronreferentie: str = ""
    tokens_in: int = 0
    tokens_out: int = 0
    tijdstip: str = Field(default_factory=_now)


class Job(BaseModel):
    id: str
    state: JobState = JobState.queued
    bwbId: str = ""
    artikel: str = ""
    lid: str | None = None
    review: bool = True
    model_profile: str = ""
    analysefocus: str = ""
    client_id: str = ""
    current_activiteit: Literal["2", "3"] | None = None
    current_ronde: int = 0
    waarschuwingen: list[str] = Field(default_factory=list)
    error: JobFout | None = None
    provenance: list[RondeProvenance] = Field(default_factory=list)
    created: str = Field(default_factory=_now)
    updated: str = Field(default_factory=_now)

    def touch(self) -> None:
        self.updated = _now()


# --- API-responses (getypeerde contracten → ingevulde OpenAPI/Swagger) --------

class CreateAccepted(BaseModel):
    id: str
    naam: str = ""
    state: JobState


class JobSummary(BaseModel):
    id: str
    naam: str = ""
    state: JobState
    bwbId: str = ""
    artikel: str = ""
    updated: str = ""
    # Voor de eerste (SSR-)render van het live dashboard, zodat de kaart meteen compleet is i.p.v.
    # pas na de eerste SSE-tick. Daarna verrijkt de aggregate-SSE deze velden live.
    current_fase: str | None = None
    model_profile: str = ""
    tokens_in: int = 0
    tokens_out: int = 0


class FeedbackAccepted(BaseModel):
    id: str
    state: JobState
    ronde: int


class Rapport(BaseModel):
    """Het analyserapport — de primaire bron, gepresenteerd via de HTML-viewer/Markdown."""

    model_config = {"extra": "allow"}

    wet: str = ""
    bwbId: str = ""
    artikel: str = ""
    versiedatum: str = ""
    bronreferentie: str = ""
    type: str = ""
    pad: str = ""
    analysefocus: str = ""
    reikwijdte: str = ""
    geraadpleegde: str = ""
    leden: list = Field(default_factory=list)
    markeringen: list = Field(default_factory=list)
    verwijzingen: list = Field(default_factory=list)
    samenhang: str = ""
    begrippen: list = Field(default_factory=list)
    afleidingsregels: list = Field(default_factory=list)
    validatiepunten: list = Field(default_factory=list)
    reviewlog: dict = Field(default_factory=dict)
    aandachtspunten: str = ""
