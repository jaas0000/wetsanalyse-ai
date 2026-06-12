"""Pydantic-contracten — 1-op-1 met de schema's uit references/review-checkpoints.md.

Deze modellen zijn de waarheid voor (de)serialisatie en validatie van de artefacten op disk.
De mechanische JAS-controles zitten in validation.py (hergebruik van de skill-scripts).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


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
    algemeen: str = ""

    def is_akkoord_zonder_opmerkingen(self) -> bool:
        return self.status == "akkoord" and not self.items and not self.algemeen.strip()


# --- API-requests -------------------------------------------------------------

class StartRequest(BaseModel):
    bwbId: str | None = None
    wet: str | None = None
    artikel: str
    lid: str | None = None
    analysefocus: str | None = None
    review: bool = True
    model_profile: str | None = None


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
