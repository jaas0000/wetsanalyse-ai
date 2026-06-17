"""Pydantic-contracten — 1-op-1 met de schema's uit references/review-checkpoints.md.

Deze modellen zijn de waarheid voor (de)serialisatie en validatie van de artefacten op disk.
De mechanische JAS-controles zitten in validation.py (hergebruik van de skill-scripts).

De analyse-eenheid is het **werkgebied** (kennisdomein) met **meerdere bronnen**. Activiteit 2
levert per bron markeringen/verwijzingen (geaggregeerd in `Analyse2.bronnen`); activiteit 3 is
werkgebied-breed: één gedeelde begrippenlijst + afleidingsregels (`Analyse3`). Id's zijn
werkgebied-breed uniek; elke markering/verwijzing draagt daarnaast een `bron_id`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Werkgebied + bron (gedeeld) ----------------------------------------------

class Werkgebied(BaseModel):
    """Het werkgebied (kennisdomein) — de afbakening waarbinnen de analyse plaatsvindt."""

    naam: str = ""
    hoofdvraag: str = ""
    omschrijving: str = ""
    scoping: str = ""   # stap 1: overwogen hoofdstukken/artikelen, in/uit-scope + reden


class Vindplaats(BaseModel):
    """Absolute, cross-bron vindplaats: welke bron + (optioneel) welk lid."""

    bron_id: str = ""
    lid: str = ""


class BronRef(BaseModel):
    """Lichte bron-index (bron_id → leesbaar label) zodat act-3 zelfstandig leesbaar is.

    Activiteit 3 draagt geen volledige bronnen, maar wel deze index, zodat de review-viewer
    en de validatie een `vindplaatsen.bron_id` naar een leesbaar label kunnen herleiden.
    """

    bron_id: str = ""
    label: str = ""
    bwbId: str = ""
    artikel: str = ""
    lid: str | None = None


# --- Activiteit 2 -------------------------------------------------------------

class Lid(BaseModel):
    lid: str
    tekst: str = ""
    bronreferentie: str = ""


class Markering(BaseModel):
    id: str
    bron_id: str = ""      # werkgebied-breed unieke id's; bron_id maakt de bron herleidbaar
    formulering: str = ""
    klasse: str = ""
    vindplaats: str = ""   # lid-relatief binnen de bron (bv. "lid 2")
    toelichting: str = ""
    twijfel: str = ""


class VerwijzingDoel(BaseModel):
    label: str = ""
    target: str = ""   # ruwe JCI/BWB-verwijzing (opaque), indien bekend
    bwbId: str = ""


class Verwijzing(BaseModel):
    """Eén uitgaande verwijzing van een bron — zie references/verwijzingen-volgen.md.

    Aparte as náást de markeringen (uitgaande pointers). `volgen` is de fetch-afweging:
    de orchestrator haalt alleen te-volgen verwijzingen daadwerkelijk op (begrensd).
    """

    id: str
    bron_id: str = ""
    bron_lid: str = ""
    soort: str = ""        # intref | extref | natuurlijk
    functie: str = ""      # definitie | schakel | delegatie | intra-artikel | informatief
    doel: VerwijzingDoel = Field(default_factory=VerwijzingDoel)
    status: str = ""       # opgehaald | gevolgd | gesignaleerd | buiten-scope-diepte
    betekenis: str = ""
    volgen: bool = False    # of de orchestrator de verwezen tekst moet ophalen


class Bron(BaseModel):
    """Eén bron in het werkgebied: een (bwbId, artikel, lid?)-eenheid met haar act-2-uitkomst."""

    bron_id: str
    label: str = ""        # leesbaar, bv. "Zvw art. 43 lid 2"
    wet: str = ""
    bwbId: str = ""
    artikel: str = ""
    lid: str | None = None
    versiedatum: str = ""
    bronreferentie: str = ""
    type: str = ""
    pad: str = ""
    reikwijdte: str = ""
    geraadpleegde: str = ""
    leden: list[Lid] = Field(default_factory=list)
    markeringen: list[Markering] = Field(default_factory=list)
    verwijzingen: list[Verwijzing] = Field(default_factory=list)
    samenhang: str = ""


class Analyse2(BaseModel):
    werkgebied: Werkgebied = Field(default_factory=Werkgebied)
    analysefocus: str = ""
    bronnen: list[Bron] = Field(default_factory=list)


# --- Activiteit 3 -------------------------------------------------------------

class Begrip(BaseModel):
    id: str
    naam: str = ""                                         # de voorkeursterm (uniek per werkgebied)
    synoniemen: list[str] = Field(default_factory=list)   # alternatieve termen voor hetzelfde begrip
    klasse: str = ""
    definitie: str = ""
    grondformulering: str = ""                            # letterlijke wetformulering (homoniem-herleiding)
    voorbeeld: str = ""
    kenmerken: str = ""
    vindplaatsen: list[Vindplaats] = Field(default_factory=list)
    verwijst_naar_begrippen: list[str] = Field(default_factory=list)  # begrip-id's in de omschrijving
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
    vindplaatsen: list[Vindplaats] = Field(default_factory=list)
    twijfel: str = ""


class Analyse3(BaseModel):
    werkgebied: Werkgebied = Field(default_factory=Werkgebied)
    bronnen: list[BronRef] = Field(default_factory=list)   # lichte index voor vindplaats-labels
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

class BronInput(BaseModel):
    """Eén bron-keuze bij het aanmaken van een werkgebied-analyse."""

    bwbId: str | None = Field(default=None, max_length=64)
    artikel: str = Field(min_length=1, max_length=32)
    lid: str | None = Field(default=None, max_length=16)


class StartRequest(BaseModel):
    bronnen: list[BronInput] = Field(min_length=1, max_length=50)
    naam: str = Field(default="", max_length=200)           # werkgebied-naam
    omschrijving: str = Field(default="", max_length=2000)
    analysefocus: str | None = Field(default=None, max_length=2000)  # hoofdvraag
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
    naam: str = ""
    bronnen: list[BronInput] = Field(default_factory=list)
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
    bronnen: list[BronInput] = Field(default_factory=list)
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
    """Het werkgebied-analyserapport — de primaire bron, gepresenteerd via de HTML-viewer/Markdown."""

    model_config = {"extra": "allow"}

    werkgebied: dict = Field(default_factory=dict)   # naam, hoofdvraag, omschrijving, scoping, analysefocus
    bronnen: list = Field(default_factory=list)      # per bron: metadata + leden/markeringen/verwijzingen/samenhang
    begrippen: list = Field(default_factory=list)
    afleidingsregels: list = Field(default_factory=list)
    validatiepunten: list = Field(default_factory=list)
    reviewlog: dict = Field(default_factory=dict)
    aandachtspunten: str = ""
