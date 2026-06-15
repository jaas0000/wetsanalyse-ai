"""Validatie — hergebruikt de skill-checks en voegt de harde brongetrouwheid-invariant toe.

Twee soorten:
  - ZACHT (schema/volledigheid): de bestaande check_activiteit_2/3 uit validate_analyse.py.
    Blokkeert in review:true vóór het checkpoint; logt-maar-blokkeert-niet in review:false.
  - HARD (brongetrouwheid): geldt ALTIJD, ook in review:false. Faalt dit na auto-correctie,
    dan gaat de job naar `fout` — nooit stil naar `klaar`.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

from .config import SKILL_SCRIPTS


def _load_skill_module(naam: str):
    """Laad een skill-script als module (de scripts vormen geen package)."""
    if str(SKILL_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SKILL_SCRIPTS))
    pad = SKILL_SCRIPTS / f"{naam}.py"
    spec = importlib.util.spec_from_file_location(naam, pad)
    if spec is None or spec.loader is None:
        raise ImportError(f"Kan skill-script niet laden: {pad}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_validate = _load_skill_module("validate_analyse")
GELDIGE_JAS_KLASSEN: set[str] = _validate.GELDIGE_JAS_KLASSEN  # canonieke bron (drift-fix)
GELDIGE_REGELTYPEN: set[str] = _validate.GELDIGE_REGELTYPEN


# Concerns die in de API door de harde, genormaliseerde brongetrouwheid_check worden gedekt.
# De zachte skill-checks rapporteren ze óók (rauwe substring-match, zonder normalisatie), wat tot
# dubbele en soms vals-positieve waarschuwingen leidt. We filteren ze hier zodat per concern nog
# precies één — de harde — melding overblijft. De skill-scripts zelf blijven ongemoeid: in het
# skill-spoor (zonder harde check) zijn deze waarschuwingen de enige citaat/vindplaats-controle.
_OVERLAPT_MET_HARD = (
    "lijkt geen letterlijk citaat",        # citaat (act 2)
    "Veld 'vindplaats' ontbreekt",         # vindplaats (act 2)
    "geen 'vindplaats'",                   # vindplaats (act 3: begrip/afleidingsregel)
)


def schema_check(data: dict, activiteit: str) -> tuple[list[str], list[str]]:
    """Zachte schema/volledigheidscheck — delegeert naar de skill-functies.

    Waarschuwingen die de harde brongetrouwheid_check al dekt (citaat, vindplaats) worden
    uitgefilterd om dubbele meldingen in de review te voorkomen.
    """
    if activiteit == "2":
        fouten, waarschuwingen = _validate.check_activiteit_2(data)
    else:
        fouten, waarschuwingen = _validate.check_activiteit_3(data)
    waarschuwingen = [
        w for w in waarschuwingen if not any(m in w for m in _OVERLAPT_MET_HARD)
    ]
    return fouten, waarschuwingen


# --- harde brongetrouwheid-invariant -----------------------------------------

_WS = re.compile(r"\s+")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "«": '"', "»": '"'})


def normaliseer(tekst: str) -> str:
    """Normaliseer whitespace + typografische quotes zodat echte citaten niet vals-positief zijn."""
    return _WS.sub(" ", tekst.translate(_QUOTES)).strip().lower()


def brongetrouwheid_check(data: dict, activiteit: str) -> list[str]:
    """Harde controles die altijd gelden. Geeft een lijst schendingen terug (leeg = ok)."""
    schendingen: list[str] = []

    if not (data.get("bronreferentie") or "").strip():
        schendingen.append("Bronreferentie (jci) ontbreekt — moet uit de MCP komen, niet uit het LLM.")

    if activiteit == "2":
        leden_genorm = normaliseer(
            " ".join((lid.get("tekst") or "") for lid in (data.get("leden") or []))
        )
        for m in data.get("markeringen") or []:
            mid = m.get("id", "?")
            if not (m.get("vindplaats") or "").strip():
                schendingen.append(f"[{mid}] Vindplaats ontbreekt (herleidbaarheid verplicht).")
            formulering = (m.get("formulering") or "").strip()
            # Hergebruik de canonieke citaat-toets uit het skill-script (drift-fix): die
            # respecteert beletselteken ('...'/'…') voor geelideerde tussentekst en vierkante-
            # haak-invoegingen ([...]) — citeerconventies die een platte substring-toets breken.
            # `normaliseer` raakt punten/beletseltekens/haken niet, dus de fragmentlogica werkt
            # correct op de al-genormaliseerde formulering tegen de genormaliseerde leden-tekst.
            if (
                formulering
                and leden_genorm
                and not _validate.fragmenten_letterlijk(normaliseer(formulering), leden_genorm)
            ):
                kort = formulering[:60] + ("…" if len(formulering) > 60 else "")
                schendingen.append(
                    f"[{mid}] Formulering is geen letterlijk citaat uit de leden-tekst: '{kort}'"
                )
    else:
        for item in (data.get("begrippen") or []) + (data.get("afleidingsregels") or []):
            iid = item.get("id", "?")
            if not (item.get("vindplaats") or "").strip():
                schendingen.append(f"[{iid}] Vindplaats ontbreekt (herleidbaarheid verplicht).")

    return schendingen
