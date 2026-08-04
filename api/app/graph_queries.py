"""Geparametriseerde SPARQL-bouwers + resultaatparser voor de kennisgraaf (act-2-bron).

**Gedupliceerd** van `tools/graph-qa/agent/graph/queries.py` en `graph/results.py` — bewust een
eigen kopie in de api (keuze: API-native zonder gedeeld pakket), zodat de act-2-generatie op de
job-modelprofiel-LLM + eigen GraphDB-client draait. Houd de patronen in sync met het graph-qa-
origineel als de ontologie wijzigt. De invoer wordt gevalideerd/ge-escaped zodat een tool-argument
geen SPARQL kan injecteren.
"""
from __future__ import annotations

import json
import re

PREFIXES = """PREFIX bwb: <https://ipalm.nl/ns/bwb#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
"""

# Eigen IRI-ruimte — filter hierop om owl:sameAs-tweelingen (wetten.overheid.nl) buiten resultaten te houden.
NS = "https://ipalm.nl/bwb/"

_BWB_RE = re.compile(r"^BWBR\d+$")
_ART_RE = re.compile(r"^[0-9]+[a-z]*$", re.IGNORECASE)
_NUM_RE = re.compile(r"^[0-9]+[a-z]*$", re.IGNORECASE)
# Vrij bepaling-nummer: decimale (divisie-)vormen en letters: "9", "9.1", "22a", "22bis".
_NUMMER_VRIJ_RE = re.compile(r"^[0-9]+(\.[0-9]+)*[a-z]*$", re.IGNORECASE)


def _bwb(value: str) -> str:
    v = str(value).strip()
    if not _BWB_RE.match(v):
        raise ValueError(f"Ongeldig BWB-id: {value!r} (verwacht 'BWBR' gevolgd door cijfers).")
    return v


def _art(value: str) -> str:
    v = str(value).strip()
    if not _ART_RE.match(v):
        raise ValueError(f"Ongeldig artikelnummer: {value!r}.")
    return v


def _num(value: str) -> str:
    v = str(value).strip()
    if not _NUM_RE.match(v):
        raise ValueError(f"Ongeldig nummer: {value!r}.")
    return v


def _nummer_vrij(value: str) -> str:
    v = str(value).strip()
    if not _NUMMER_VRIJ_RE.match(v):
        raise ValueError(f"Ongeldig bepaling-nummer: {value!r} (verwacht bv. '9', '9.1', '22a').")
    return v


def _lit(text: str) -> str:
    """Veilige SPARQL-stringliteral."""
    s = str(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", " ")
    return f'"{s}"'


# --- IRI-bouwers ---------------------------------------------------------------

def regeling_iri(bwb_id: str) -> str:
    return f"{NS}{_bwb(bwb_id)}"


def artikel_iri(bwb_id: str, artikel: str) -> str:
    return f"{NS}{_bwb(bwb_id)}/artikel/{_art(artikel)}"


def lid_iri(bwb_id: str, artikel: str, lid: str) -> str:
    return f"{artikel_iri(bwb_id, artikel)}/lid/{_num(lid)}"


# --- Query-bouwers -------------------------------------------------------------

def get_artikel(bwb_id: str, artikel: str) -> str:
    iri = artikel_iri(bwb_id, artikel)
    return PREFIXES + f"""SELECT ?tekst ?jci ?lid ?lidnummer ?lidtekst WHERE {{
  OPTIONAL {{ <{iri}> bwb:tekst ?tekst }}
  OPTIONAL {{ <{iri}> bwb:jci ?jci }}
  OPTIONAL {{
    <{iri}> bwb:heeftLid ?lid .
    FILTER(STRSTARTS(STR(?lid), "{NS}"))
    OPTIONAL {{ ?lid bwb:nummer ?lidnummer }}
    OPTIONAL {{ ?lid bwb:tekst ?lidtekst }}
  }}
}} ORDER BY ?lid"""


def get_lid(bwb_id: str, artikel: str, lid: str) -> str:
    iri = lid_iri(bwb_id, artikel, lid)
    return PREFIXES + f"""SELECT ?nummer ?tekst ?jci WHERE {{
  OPTIONAL {{ <{iri}> bwb:nummer ?nummer }}
  OPTIONAL {{ <{iri}> bwb:tekst ?tekst }}
  OPTIONAL {{ <{iri}> bwb:jci ?jci }}
}}"""


def get_bepaling(bwb_id: str, nummer: str) -> str:
    """Bepaling via `bwb:nummer` binnen de regeling — voor artikelen ("9", "22a") én divisies/
    decimale nummers ("9.1") van beleidsregels/circulaires waar het artikel/lid-IRI-patroon niet opgaat."""
    return PREFIXES + f"""SELECT ?nummer ?tekst ?label ?jci WHERE {{
  ?node bwb:nummer {_lit(_nummer_vrij(nummer))} ; bwb:tekst ?tekst .
  FILTER(STRSTARTS(STR(?node), "{NS}{_bwb(bwb_id)}"))
  BIND({_lit(_nummer_vrij(nummer))} AS ?nummer)
  OPTIONAL {{ ?node rdfs:label ?label }}
  OPTIONAL {{ ?node bwb:jci ?jci }}
}} LIMIT 5"""


def get_regeling_info(bwb_id: str) -> str:
    iri = regeling_iri(bwb_id)
    return PREFIXES + f"""SELECT ?citeertitel ?opschrift ?afkorting ?soort ?versiedatum WHERE {{
  OPTIONAL {{ <{iri}> bwb:citeertitel ?citeertitel }}
  OPTIONAL {{ <{iri}> bwb:opschrift ?opschrift }}
  OPTIONAL {{ <{iri}> bwb:afkorting ?afkorting }}
  OPTIONAL {{ <{iri}> bwb:soort ?soort }}
  OPTIONAL {{ <{iri}> bwb:geldigVanaf ?versiedatum }}
}}"""


def follow_verwijzingen(bwb_id: str, artikel: str, lid: str | None = None) -> str:
    node = lid_iri(bwb_id, artikel, lid) if lid else artikel_iri(bwb_id, artikel)
    return PREFIXES + f"""SELECT ?ankerTekst ?naar ?soort ?doelSoort WHERE {{
  <{node}> bwb:heeftVerwijzing ?v .
  OPTIONAL {{ ?v bwb:ankerTekst ?ankerTekst }}
  OPTIONAL {{ ?v bwb:naar ?naar }}
  OPTIONAL {{ ?v bwb:soort ?soort }}
  OPTIONAL {{ ?v bwb:doelSoort ?doelSoort }}
}}"""


def dekking(bwb_id: str, artikel: str) -> str:
    """Dekkings-preflight: bestaat er tekst voor dit (bwbId, artikel) in de graaf?
    Telt de artikeltekst, de leden-tekst én de bepaling-op-nummer (decimale nummers), in de eigen
    IRI-ruimte. `?aantal` > 0 = gedekt. Robuust tegen zowel het artikel/lid- als het nummer-patroon."""
    iri = artikel_iri(bwb_id, artikel) if _ART_RE.match(str(artikel).strip()) else None
    nummer_lit = _lit(_nummer_vrij(artikel))
    art_block = ""
    if iri:
        art_block = f"""
    {{ <{iri}> bwb:tekst ?t }}
    UNION {{ <{iri}> bwb:heeftLid ?l . ?l bwb:tekst ?t . FILTER(STRSTARTS(STR(?l), "{NS}")) }}
    UNION"""
    return PREFIXES + f"""SELECT (COUNT(?t) AS ?aantal) WHERE {{ {{{art_block}
    {{ ?node bwb:nummer {nummer_lit} ; bwb:tekst ?t .
      FILTER(STRSTARTS(STR(?node), "{NS}{_bwb(bwb_id)}")) }}
  }} }}"""


# --- Resultaatparser (SPARQL Query Results TSV, W3C) ---------------------------
# Gedupliceerd van tools/graph-qa/agent/graph/results.py.

_LITERAL = re.compile(r'^"(.*)"(?:@[\w-]+|\^\^\S+)?$', re.DOTALL)
_ESCAPES = {"t": "\t", "n": "\n", "r": "\r", "\\": "\\", '"': '"', "'": "'"}


def _unescape(s: str) -> str:
    out: list[str] = []
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if ch == "\\" and i + 1 < n:
            out.append(_ESCAPES.get(s[i + 1], s[i + 1]))
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _decode_term(term: str) -> str:
    t = term.strip()
    if not t:
        return ""
    if t.startswith("<") and t.endswith(">"):
        return t[1:-1]
    m = _LITERAL.match(t)
    if m:
        return _unescape(m.group(1))
    return t  # kaal getal/boolean


def parse_select(tsv: str) -> list[dict[str, str]]:
    """Parseer SPARQL-TSV naar rijen [{var: waarde}]. Lege/ongeldige invoer → []."""
    raw = (tsv or "").strip()
    # De GraphDB-MCP levert de TSV JSON-string-encoded (buitenste `"`, met \t/\n/\" als escapes).
    if raw.startswith('"'):
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, str):
                tsv = decoded
        except json.JSONDecodeError:
            pass
    lines = (tsv or "").split("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()
    if not lines:
        return []
    header = [h.strip().lstrip("?") for h in lines[0].split("\t")]
    rows: list[dict[str, str]] = []
    for line in lines[1:]:
        if line.strip() == "":
            continue
        cells = line.split("\t")
        rows.append({header[i]: (_decode_term(cells[i]) if i < len(cells) else "") for i in range(len(header))})
    return rows
