"""Pydantic models voor de wetsanalyse webapp."""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, Union
from enum import Enum


# ── Gebruikers ────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    username: str
    password: str


class ApiKeyUpdate(BaseModel):
    provider: str = Field(..., pattern="^(azure|openrouter)$", description="LLM provider: azure of openrouter")
    endpoint: str = Field(..., description="Endpoint URL (Azure of OpenRouter)")
    api_key: str = Field(..., description="API key")
    model: str = Field(..., description="Model identifier (Azure deployment naam of OpenRouter model)")


# ── Analyse ──────────────────────────────────────────────────────────────────

class AnalyseStart(BaseModel):
    wet: str = Field(..., description="Wetsnaam of zoekterm, bijv. 'Invorderingswet 1990'")
    artikel: str = Field(..., description="Artikelnummer, bijv. '9'")
    lid: Optional[str] = Field(default=None, description="Optioneel lidnummer")
    peildatum: Optional[str] = Field(default=None, description="YYYY-MM-DD, default = vandaag")


class AnalyseStatus(str, Enum):
    OPHALEN = "ophalen"
    CLASSIFICATIE = "classificatie"
    REVIEW_2 = "review_2"
    BETEKENIS = "betekenis"
    REVIEW_3 = "review_3"
    RAPPORTEREN = "rapporteren"
    KLAAR = "klaar"
    FOUT = "fout"


# ── Review ────────────────────────────────────────────────────────────────────

class ReviewItem(BaseModel):
    item_id: str
    feedback: str = ""


class ReviewSubmit(BaseModel):
    analyse_id: str
    activiteit: int = Field(..., ge=2, le=3)
    status: str = Field(..., pattern="^(akkoord|wijzigingen)$")
    items: dict[str, str] = Field(default_factory=dict)
    algemeen: str = ""


# ── SRU / BWB types ──────────────────────────────────────────────────────────

class Regeling(BaseModel):
    bwb_id: str
    titel: str
    type: str
    ministerie: str
    rechtsgebied: str
    geldig_vanaf: str
    geldig_tot: str
    gewijzigd: str
    repository_url: str


class ZoekResultaat(BaseModel):
    totaal: int
    regelingen: list[Regeling]


class LidData(BaseModel):
    lid: str
    tekst: str


class ArtikelResultaat(BaseModel):
    formaat: str  # "plain" | "markdown"
    citeertitel: str
    versiedatum: str
    bwb_id: str
    artikel: str
    lid: Optional[str] = None
    sectie: Optional[str] = None
    pad: Optional[str] = None
    leden: list[LidData]
    bronreferentie: str


class StructuurNode(BaseModel):
    type: str
    nr: str
    titel: Optional[str] = None
    artikelen: Optional[list[str]] = None
    secties: Optional[list["StructuurNode"]] = None


class StructuurResultaat(BaseModel):
    bwb_id: str
    citeertitel: str
    versiedatum: str
    structuur: list[StructuurNode]


# ── Analyse output types ─────────────────────────────────────────────────────

class Markering(BaseModel):
    id: str
    formulering: str
    klasse: str
    vindplaats: str
    toelichting: str = ""


class Begrip(BaseModel):
    id: str
    naam: str
    klasse: str
    definitie: str
    voorbeeld: str = ""
    kenmerken: str = ""
    vindplaats: str
    twijfel: str = ""


class Afleidingsregel(BaseModel):
    id: str
    naam: str
    type: str  # "beslisregel" | "rekenregel" | "specialisatieregel"
    uitvoervariabele: str
    invoervariabelen: Union[str, list] = ""
    parameters: Union[str, list] = ""
    voorwaarden: Union[str, list] = ""
    formulering: str = ""
    vindplaats: str
    twijfel: str = ""

    @field_validator("invoervariabelen", "parameters", "voorwaarden", mode="before")
    @classmethod
    def _to_str(cls, v):
        """Converteer lijsten en dicts naar strings."""
        if isinstance(v, dict):
            return "; ".join(f"{k}: {val}" for k, val in v.items())
        if isinstance(v, list):
            return ", ".join(str(x) for x in v)
        return v


class Activiteit2Data(BaseModel):
    wet: str
    bwb_id: str
    artikel: str
    versiedatum: str
    bronreferentie: str
    leden: list[LidData]
    markeringen: list[Markering]
    samenhang: str = ""


class Activiteit3Data(BaseModel):
    wet: str
    bwb_id: str
    artikel: str
    versiedatum: str
    bronreferentie: str
    begrippen: list[Begrip]
    afleidingsregels: list[Afleidingsregel]
    validatiepunten: Union[str, list] = ""

    @field_validator("validatiepunten", mode="before")
    @classmethod
    def _to_str(cls, v):
        if isinstance(v, dict):
            return "; ".join(f"{k}: {val}" for k, val in v.items())
        if isinstance(v, list):
            return "\n".join(str(x) for x in v)
        return v
