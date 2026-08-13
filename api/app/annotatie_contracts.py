"""
Contracten voor het annotatie-domein (wetsanalyse-workbench).

Bewust **los** van `contracts.py` (de analyse-job/skill-contracten): dit is een vers, toekomstvast
domein. Review-klaar ontworpen — velden voor latere fasen (aandacht, diff, alternatieven, lifecycle,
review_reason) zitten er vanaf het begin in. De JAS-klassenamen worden gevalideerd tegen de canonieke
`validation.GELDIGE_JAS_KLASSEN` (neutrale data, geen skill-werkstroom) — dat gebeurt in de router.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from .db import utcnow


# --- enums -------------------------------------------------------------------

class DocumentStatus(str, Enum):
    in_review = "in_review"
    geaccordeerd = "geaccordeerd"
    gepromoveerd = "gepromoveerd"


class Lifecycle(str, Enum):
    voorgesteld = "voorgesteld"
    critic_checked = "critic_checked"
    human_approved = "human_approved"
    edited = "edited"
    rejected = "rejected"
    published = "published"
    reused = "reused"


class BeslissingType(str, Enum):
    approve = "approve"
    edit = "edit"
    reject = "reject"
    comment = "comment"


class ReviewReason(str, Enum):
    verkeerde_klasse = "verkeerde_klasse"
    bron_gemist = "bron_gemist"
    tekst = "tekst"
    interpretatie = "interpretatie"
    onvoldoende_context = "onvoldoende_context"
    anders = "anders"


class Aandacht(str, Enum):
    groen = "groen"
    geel = "geel"
    rood = "rood"


# --- domein ------------------------------------------------------------------

class Alternatief(BaseModel):
    """Kandidaat-klasse bij twijfel (disambiguatie)."""

    klasse: str
    motivatie: str = ""


class Beslissing(BaseModel):
    """Eén human-decision op een element."""

    type: BeslissingType
    actor: str = ""
    tijd: datetime = Field(default_factory=utcnow)
    review_reason: ReviewReason | None = None
    comment: str = ""
    wijziging: dict = {}   # bij een edit: de gewijzigde velden (klasse/tekst/toelichting/lid)


class CriticRonde(BaseModel):
    """Eén Critic-oordeel binnen de herzieningslus, met de instructie die eruit volgde.

    Een lijst hiervan (analoog aan `beslissingen`) maakt het heen-en-weer tussen annoteerder en
    Critic zichtbaar: 'ronde 1 rood, klasse te grof → ronde 2 aangepast naar Voorwaarde'. Een
    enkelvoudige `aandacht`/`critic` zou elke ronde overschrijven en dat spoor wissen.
    """

    ronde: int
    aandacht: Aandacht | None = None
    motivatie: str = ""
    actie: str = "behoud"          # behoud | vervang | verwijder
    voorstel_klasse: str = ""
    voorstel_tekst: str = ""
    tijd: datetime = Field(default_factory=utcnow)


class CriticSuggestie(BaseModel):
    """Critic-oordeel op een element dat de JURIST maakte. Puur advies: wordt nooit toegepast."""

    aandacht: Aandacht | None = None
    motivatie: str = ""
    voorstel_klasse: str = ""
    voorstel_tekst: str = ""
    status: str = "open"           # open | geaccepteerd | afgewezen
    tijd: datetime = Field(default_factory=utcnow)


class Anker(BaseModel):
    """Waar een fragment stond toen het werd gemaakt.

    Twee selectors naast elkaar (het W3C-annotatiepatroon): exacte offsets voor precisie — nodig om
    twee identieke fragmenten in één artikel te onderscheiden — en quote-met-context als de brontekst
    schuift (herimport, ander lid-bereik). `bron_hash` vertelt of de offsets nog over dezelfde tekst
    gaan. De offsets slaan op de samengevoegde brontekst die het documentpaneel toont.
    """

    lid: str = ""
    start: int = 0
    eind: int = 0
    voor: str = ""        # tot 48 tekens context vóór het fragment
    na: str = ""          # tot 48 tekens context erna
    bron_hash: str = ""   # sha256 van de brontekst, ingekort


class AnnotatieElement(BaseModel):
    """Eén JAS-annotatie-element met zijn review-levenscyclus."""

    id: str
    klasse: str
    tekst: str
    lid: str = ""
    toelichting: str = ""
    vindplaats: str = ""
    # `herkomst` is ONVERANDERLIJK: wie het element heeft aangemaakt. `gewijzigd_door` is wie het
    # daarna inhoudelijk aanpaste. Die twee zijn bewust gescheiden — anders is niet meer te zien of
    # een element van de agent kwam zodra de jurist het één keer bijstelt.
    herkomst: str = "agent"        # agent | mens — aangemaakt door
    gewijzigd_door: str = ""       # "" | agent | mens — laatst inhoudelijk gewijzigd door
    lifecycle: Lifecycle = Lifecycle.voorgesteld
    alternatieven: list[Alternatief] = []
    aandacht: Aandacht | None = None
    critic: str = ""           # korte Critic-motivatie bij het aandacht-niveau (laatste ronde)
    critic_rondes: list[CriticRonde] = []
    critic_suggestie: CriticSuggestie | None = None   # alleen bij herkomst == "mens"
    anker: Anker | None = None
    diff: dict = {}            # bij een edit: {veld: {"voor": ..., "na": ...}}
    beslissingen: list[Beslissing] = []

    @model_validator(mode="after")
    def _herstel_herkomst(self):
        """Repareer rijen van vóór de scheiding tussen aanmaken en wijzigen.

        Tot dan zette een edit `herkomst` op "mens", terwijl de jurist toen nog helemaal geen
        elementen kón aanmaken. Zo'n element is dus agent-gemaakt en mens-gewijzigd. De reparatie is
        lazy (draait bij elke `model_validate`) en alleen-vooruit: zonder beslissingen blijft
        "mens" gewoon staan, want dat is dan een echt door de jurist aangemaakt element.
        """
        if not self.gewijzigd_door and self.herkomst == "mens" and self.beslissingen:
            object.__setattr__(self, "herkomst", "agent")
            object.__setattr__(self, "gewijzigd_door", "mens")
        return self


class AnnotatieDocument(BaseModel):
    """Annotaties per bron (bwbId+artikel[+lid]) binnen een werkgebied."""

    slug: str
    user_id: str = ""       # eigenaar (ingelogde gebruiker); de zichtbaarheid gaat hierop
    client_id: str = ""      # bearer-client (herkomst/tenant)
    werkgebied: str = ""
    bwbId: str
    artikel: str
    lid: str = ""
    status: DocumentStatus = DocumentStatus.in_review
    elementen: list[AnnotatieElement] = []
    created: datetime | None = None
    updated: datetime | None = None


class AuditRecord(BaseModel):
    """Append-only auditregel; render-baar als tijdlijn."""

    id: int | None = None
    actor: str = ""
    actie: str
    element_id: str | None = None
    detail: dict = {}
    tijdstip: datetime | None = None


# --- invoer / uitvoer --------------------------------------------------------

class DocumentCreate(BaseModel):
    bwbId: str
    artikel: str
    lid: str | None = None
    werkgebied: str = ""


class ElementInvoer(BaseModel):
    """Eén voorgesteld element (van de agent), zoals de workbench het doorstuurt."""

    # Het id van de agent. Is het bekend, dan matcht de merge daarop en blijven beslissingen en
    # levenscyclus intact; ontbreekt het (oudere client), dan valt de merge terug op de tekst.
    id: str | None = None
    klasse: str
    tekst: str
    lid: str = ""
    toelichting: str = ""
    vindplaats: str = ""
    alternatieven: list[Alternatief] = []
    aandacht: Aandacht | None = None   # Critic-oordeel (groen|geel|rood); None = geen Critic-pas
    critic: str = ""                   # korte Critic-motivatie
    critic_rondes: list[CriticRonde] = []
    anker: Anker | None = None


class ElementenInvoer(BaseModel):
    """De volledige uitkomst van één agent-ronde voor dit document."""

    elementen: list[ElementInvoer]
    ronde: int = 0
    # Agent-elementen die in deze ronde niet meer voorkomen: intrekken (default) of laten staan.
    # Elementen van de jurist en elementen met een beslissing worden nooit ingetrokken.
    trek_ontbrekende_in: bool = True


class MensElementInvoer(BaseModel):
    """Eén element dat de JURIST zelf aanmaakt (tekstselectie in het documentpaneel)."""

    klasse: str
    tekst: str
    lid: str = ""
    toelichting: str = ""
    vindplaats: str = ""
    anker: Anker | None = None


class Wijziging(BaseModel):
    """Voorgestelde veldwijzigingen bij een edit-beslissing (alle optioneel)."""

    klasse: str | None = None
    tekst: str | None = None
    toelichting: str | None = None
    lid: str | None = None


class BeslissingInvoer(BaseModel):
    type: BeslissingType
    review_reason: ReviewReason | None = None
    comment: str = ""
    wijziging: Wijziging | None = None


class DocumentSamenvatting(BaseModel):
    slug: str
    bwbId: str
    artikel: str
    lid: str = ""
    werkgebied: str = ""
    status: DocumentStatus
    aantal_elementen: int
    updated: datetime | None = None
