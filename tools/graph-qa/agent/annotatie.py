"""
Annotatie-grounding-helpers: parse de JAS-JSON van het model en verifieer elk element **brongetrouw**
(het fragment moet letterlijk in de opgehaalde artikeltekst voorkomen). Niet-onderbouwde of
ongeldig-geclassificeerde voorstellen worden verworpen (nooit stil doorgelaten). Gebruikt door de
annoteer-stap in `orchestrator.py` (`_parse_elementen`/`_verwerk`).
"""
from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from typing import Any

from .jas_klassen import GELDIGE_JAS_KLASSEN
from .models import AnnotatieAlternatief, AnnotatieVoorstel, OntbrekendItem

logger = logging.getLogger("graph_qa.annotatie")

_AANDACHT = {"groen", "geel", "rood"}

_WS = re.compile(r"\s+")


def _normaliseer(s: str) -> str:
    """Collapse witruimte, zodat een fragment ondanks layout-verschillen matcht."""
    return _WS.sub(" ", s or "").strip()


def _balanced_objecten(text: str) -> Iterator[str]:
    """Yield elke gebalanceerde {…}-substring op élk niveau (string-/escape-bewust).

    Elementen zitten genest in de wrapper `{"elementen": [ {…}, {…} ]}`, dus we moeten ook geneste
    objecten opleveren. Een afgekapt (nooit-gesloten) object levert niets op — precies wat we willen.
    """
    stack: list[int] = []
    in_str = False
    escape = False
    for i, ch in enumerate(text):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append(i)
        elif ch == "}":
            if stack:
                yield text[stack.pop() : i + 1]


def _parse_elementen(text: str) -> list[dict[str, Any]]:
    """Haal de element-objecten uit de LLM-respons.

    Fast-path: de hele respons als één JSON-object met `elementen`. Faalt dat (proza eromheen,
    afgekapt op max_tokens, code-fences), dan **salvagen** we de losse gebalanceerde {…}-objecten die
    op een element lijken (met `klasse` én `tekst`) — zo overleeft een afgekapt of omlijst antwoord
    (het onvolledige laatste object valt weg, de complete blijven) i.p.v. dat álles wegvalt.
    """
    raw = (text or "").strip()
    kandidaat = raw
    if kandidaat.startswith("```"):
        kandidaat = kandidaat.strip("`")
        if kandidaat.lower().startswith("json"):
            kandidaat = kandidaat[4:]
    s, e = kandidaat.find("{"), kandidaat.rfind("}")
    if s != -1 and e > s:
        try:
            data = json.loads(kandidaat[s : e + 1])
            if isinstance(data, dict) and isinstance(data.get("elementen"), list):
                return [x for x in data["elementen"] if isinstance(x, dict)]
        except json.JSONDecodeError:
            pass
    gered: list[dict[str, Any]] = []
    for obj in _balanced_objecten(raw):
        try:
            d = json.loads(obj)
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and "klasse" in d and "tekst" in d:
            gered.append(d)
    return gered


def _verwerk(
    llm_text: str, corpus: str, bwb_id: str, artikel: str, scope_lid: str | None = None
) -> tuple[list[AnnotatieVoorstel], int]:
    """Parse de LLM-JSON, valideer klasse + brongetrouwheid, bereken vindplaats.

    Is een `scope_lid` gezet (annotatie tot één lid), dan wint dat voor de vindplaats — elke markering
    verwijst dan naar dat lid, ook als het model het lid-veld leeg laat.
    """
    norm_corpus = _normaliseer(corpus)
    voorstellen: list[AnnotatieVoorstel] = []
    verworpen = 0
    rauw = _parse_elementen(llm_text)
    if not rauw and llm_text.strip():
        logger.warning("annotatie: geen element-objecten uit de respons gehaald")

    for e in rauw:
        klasse = str(e.get("klasse", "")).strip()
        fragment = str(e.get("tekst", "")).strip()
        norm_frag = _normaliseer(fragment)
        idx = norm_corpus.find(norm_frag) if norm_frag else -1
        # Verwerp ongeldige klasse of niet-onderbouwd fragment: nooit stil doorlaten.
        if klasse not in GELDIGE_JAS_KLASSEN or idx < 0:
            verworpen += 1
            continue
        lid = str(scope_lid).strip() if scope_lid and str(scope_lid).strip() else str(e.get("lid", "")).strip()
        alts = [
            AnnotatieAlternatief(klasse=str(a.get("klasse", "")).strip(), motivatie=str(a.get("motivatie", "")).strip())
            for a in e.get("alternatieven", [])
            if isinstance(a, dict) and str(a.get("klasse", "")).strip() in GELDIGE_JAS_KLASSEN
        ]
        vindplaats = f"{bwb_id} art. {artikel}" + (f" lid {lid}" if lid else "")
        voorstellen.append(
            AnnotatieVoorstel(
                klasse=klasse,
                tekst=fragment,
                lid=lid,
                toelichting=str(e.get("toelichting", "")).strip(),
                alternatieven=alts,
                grounded=True,
                vindplaats=vindplaats,
            )
        )
    return voorstellen, verworpen


def _verwerk_critic(llm_text: str, aantal: int) -> tuple[dict[int, tuple[str, str]], list[OntbrekendItem]]:
    """Parse het Critic-JSON: per element-index een (aandacht, motivatie) en een ontbrekend-lijst.

    Robuust tegen proza/afkapping (fast-path hele-JSON, anders de gebalanceerde {…}-objecten). Ongeldige
    aandacht-waarden of indices buiten bereik worden genegeerd (leeg gelaten). Nooit exceptions naar de
    caller — de Critic mag de annotatie niet breken.
    """
    oordelen: dict[int, tuple[str, str]] = {}
    ontbrekend: list[OntbrekendItem] = []

    data: dict[str, Any] | None = None
    raw = (llm_text or "").strip()
    kandidaat = raw.strip("`")
    if kandidaat.lower().startswith("json"):
        kandidaat = kandidaat[4:]
    s, e = kandidaat.find("{"), kandidaat.rfind("}")
    if s != -1 and e > s:
        try:
            parsed = json.loads(kandidaat[s : e + 1])
            if isinstance(parsed, dict):
                data = parsed
        except json.JSONDecodeError:
            data = None
    # Fallback: los de gebalanceerde objecten op en herken oordeel-/ontbrekend-objecten.
    oordeel_objs: list[dict[str, Any]] = []
    ontbrekend_objs: list[dict[str, Any]] = []
    if isinstance(data, dict):
        oordeel_objs = [o for o in data.get("oordelen", []) if isinstance(o, dict)]
        ontbrekend_objs = [o for o in data.get("ontbrekend", []) if isinstance(o, dict)]
    else:
        for obj in _balanced_objecten(raw):
            try:
                d = json.loads(obj)
            except json.JSONDecodeError:
                continue
            if not isinstance(d, dict):
                continue
            if "index" in d and "aandacht" in d:
                oordeel_objs.append(d)
            elif "klasse" in d and "reden" in d:
                ontbrekend_objs.append(d)

    for o in oordeel_objs:
        try:
            idx = int(o.get("index"))
        except (TypeError, ValueError):
            continue
        aandacht = str(o.get("aandacht", "")).strip().lower()
        if aandacht not in _AANDACHT or not (0 <= idx < aantal):
            continue
        oordelen[idx] = (aandacht, str(o.get("motivatie", "")).strip())

    for o in ontbrekend_objs:
        klasse = str(o.get("klasse", "")).strip()
        if klasse in GELDIGE_JAS_KLASSEN:
            ontbrekend.append(OntbrekendItem(klasse=klasse, reden=str(o.get("reden", "")).strip()))

    return oordelen, ontbrekend
