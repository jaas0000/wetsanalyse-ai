"""Prompts — gebouwd uit de references/*.md (verbatim) + de opgehaalde wettekst.

De analytische kennis blijft één gedeelde bron met de skill: we lezen dezelfde referentie-
bestanden op runtime. De canonieke JAS-klassenlijst komt uit validation (drift-fix).
"""

from __future__ import annotations

import hashlib
import json

from ..config import REFERENCES_DIR
from ..validation import GELDIGE_JAS_KLASSEN, GELDIGE_REGELTYPEN


def _hash(*teksten: str) -> str:
    h = hashlib.sha256()
    for t in teksten:
        h.update(t.encode("utf-8"))
    return h.hexdigest()[:16]


def _lees_referentie(naam: str) -> str:
    pad = REFERENCES_DIR / naam
    return pad.read_text(encoding="utf-8") if pad.exists() else ""


JAS_REF = _lees_referentie("jas-klassen-referentie.md")
BEGRIPPEN_REF = _lees_referentie("begrippen-en-afleidingsregels-opstellen.md")
REFERENTIE_HASH = _hash(JAS_REF, BEGRIPPEN_REF)

_KLASSEN = ", ".join(sorted(GELDIGE_JAS_KLASSEN))
_REGELTYPEN = ", ".join(sorted(GELDIGE_REGELTYPEN))

_SYSTEM = (
    "Je bent een juridisch analist die de methode Wetsanalyse (JAS) toepast op Nederlandse "
    "wetgeving. Brongetrouwheid is niet-onderhandelbaar:\n"
    "- Werk UITSLUITEND met de letterlijke, aangeleverde wettekst. Verzin nooit tekst, leden "
    "of artikelnummers. Citeer formuleringen LETTERLIJK (exact zoals in de leden-tekst).\n"
    "- Gebruik uitsluitend deze dertien JAS-klassen: " + _KLASSEN + ".\n"
    "- Markeer twijfel en interpretatiekeuzes expliciet i.p.v. schijnzekerheid te produceren.\n"
    "Geef UITSLUITEND geldig JSON terug, zonder uitleg of markdown-fences."
)

_ACT2_SCHEMA = {
    "markeringen": [
        {
            "id": "m1",
            "formulering": "<letterlijk citaat uit de leden-tekst>",
            "klasse": "<één van de 13 JAS-klassen>",
            "vindplaats": "lid <n>",
            "toelichting": "<waarom deze klasse; evt. alternatief>",
            "twijfel": "<optioneel>",
        }
    ],
    "samenhang": "<korte tekst over samenhang rond rechtsbetrekking/rechtsfeit>",
    "type": "<wet|amvb|ministeriële regeling|...>",
    "analysefocus": "<optioneel>",
    "reikwijdte": "<welke leden geanalyseerd; wat buiten scope>",
    "geraadpleegde": "<definitie-/aanpalende artikelen>",
}

_ACT3_SCHEMA = {
    "begrippen": [
        {
            "id": "b1",
            "naam": "<begripsnaam>",
            "klasse": "<JAS-klasse>",
            "definitie": "<brondefinitie of [interpretatie]>",
            "voorbeeld": "<kort>",
            "kenmerken": "<kenmerken/relaties>",
            "vindplaats": "<art./lid>",
            "twijfel": "<optioneel>",
        }
    ],
    "afleidingsregels": [
        {
            "id": "r1",
            "naam": "<naam>",
            "type": "<één van: " + _REGELTYPEN + ">",
            "uitvoervariabele": "...",
            "invoervariabelen": "...",
            "parameters": "...",
            "voorwaarden": "...",
            "formulering": "<gestructureerde pseudo met expliciete operatoren>",
            "vindplaats": "<art./lid>",
            "twijfel": "<optioneel>",
        }
    ],
    "validatiepunten": ["<aandachtspunt voor multidisciplinaire validatie>"],
}


def _leden_blok(basis: dict) -> str:
    regels = [f"Wet: {basis.get('wet','')} ({basis.get('bwbId','')}), artikel {basis.get('artikel','')}"]
    for lid in basis.get("leden", []):
        regels.append(f"Lid {lid.get('lid','')}: {lid.get('tekst','')}")
    return "\n".join(regels)


def act2_prompt(basis: dict, analysefocus: str | None) -> tuple[str, str, dict, str]:
    focus = f"\nAnalysefocus: {analysefocus}" if analysefocus else ""
    user = (
        "REFERENTIE — JAS-klassen (gebruik dit bij het classificeren):\n"
        + JAS_REF
        + "\n\n=== WETTEKST OM TE ANALYSEREN ===\n"
        + _leden_blok(basis)
        + focus
        + "\n\nOPDRACHT (activiteit 2): markeer fijnmazig de relevante formuleringen (vrijwel "
        "elk lid bevat meerdere markeringen) en ken elke markering één JAS-klasse toe. Gebruik "
        "stabiele id's (m1, m2, …). Elke 'formulering' MOET een letterlijk citaat uit de "
        "bovenstaande leden-tekst zijn. Vat de samenhang kort samen."
    )
    return _SYSTEM, user, _ACT2_SCHEMA, _hash(_SYSTEM, user)


def act3_prompt(basis: dict, act2: dict) -> tuple[str, str, dict, str]:
    user = (
        "REFERENTIE — begrippen en afleidingsregels opstellen:\n"
        + BEGRIPPEN_REF
        + "\n\n=== WETTEKST ===\n"
        + _leden_blok(basis)
        + "\n\n=== GECLASSIFICEERDE MARKERINGEN (activiteit 2) ===\n"
        + json.dumps({"markeringen": act2.get("markeringen", []), "samenhang": act2.get("samenhang", "")}, ensure_ascii=False, indent=2)
        + "\n\nOPDRACHT (activiteit 3): stel per betekenisdragend element een begrip op "
        "(definitie, voorbeeld, kenmerken/relaties, vindplaats) en leg de afleidingsregels vast "
        "(type, in-/uitvoer, parameters, voorwaarden, gestructureerde formulering). Hergebruik "
        "brondefinities letterlijk; markeer eigen werkdefinities als [interpretatie]. Gebruik "
        "stabiele id's (b1, r1, …). Noteer aandachtspunten als validatiepunten."
    )
    return _SYSTEM, user, _ACT3_SCHEMA, _hash(_SYSTEM, user)


def revise_prompt(
    activiteit: str, basis: dict, vorige: dict, feedback: dict
) -> tuple[str, str, dict, str]:
    schema = _ACT2_SCHEMA if activiteit == "2" else _ACT3_SCHEMA
    ref = JAS_REF if activiteit == "2" else BEGRIPPEN_REF
    user = (
        "REFERENTIE:\n"
        + ref
        + "\n\n=== WETTEKST ===\n"
        + _leden_blok(basis)
        + "\n\n=== JE VORIGE VERSIE ===\n"
        + json.dumps(vorige, ensure_ascii=False, indent=2)
        + "\n\n=== FEEDBACK VAN DE ANALIST (verwerk ELK punt) ===\n"
        + json.dumps(feedback, ensure_ascii=False, indent=2)
        + "\n\nOPDRACHT: lever de HERZIENE versie. Verwerk elke per-item-correctie (per id) en de "
        "algemene feedback. HOUD ID'S STABIEL: hetzelfde concept houdt hetzelfde id, ook na een "
        "correctie. Citeer nog steeds letterlijk uit de leden-tekst."
    )
    return _SYSTEM, user, schema, _hash(_SYSTEM, user)
