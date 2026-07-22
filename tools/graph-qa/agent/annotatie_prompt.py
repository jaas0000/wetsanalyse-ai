"""
Prompt-bouw voor de annotatie-agent.

De systeemprompt wordt opgebouwd uit de JAS-klassen-referentie (`agent/jas_klassen.py`, vers uit de
bron). De agent markeert JAS-elementen in een aangeleverde artikeltekst en geeft ze **gestructureerd**
(JSON) terug. Brongetrouwheid is heilig: alléén letterlijke fragmenten uit de tekst.
"""
from __future__ import annotations

from .jas_klassen import JAS_KLASSEN, JAS_KLASSEN_VOLGORDE


def _klassen_referentie() -> str:
    regels = []
    for k in JAS_KLASSEN:
        regels.append(
            f"- {k.naam}\n"
            f"    omschrijving: {k.omschrijving}\n"
            f"    herken-vraag: {k.vraag}\n"
            f"    uitdrukkingswijze: {k.uitdrukkingswijze}"
        )
    return "\n".join(regels)


def annotatie_systeemprompt() -> str:
    klassen = ", ".join(JAS_KLASSEN_VOLGORDE)
    return f"""Je bent een annotator die Nederlandse wetteksten analyseert volgens het Juridisch Analyseschema (JAS). Je markeert de juridische elementen in een aangeleverd artikel en classificeert elk in precies één van de dertien JAS-klassen.

DE DERTIEN JAS-KLASSEN (gebruik exact deze namen, verzin geen andere):
{_klassen_referentie()}

WERKWIJZE
- Markeer de betekenisdragende formuleringen in de aangeleverde artikeltekst en classificeer elke in de meest specifieke passende JAS-klasse. Bij een tijds- of plaatsaanduiding die ook variabele/parameter zou kunnen zijn: kies de tijds-/plaatsaanduiding.
- BRONGETROUW: het veld `tekst` is een LETTERLIJK, aaneengesloten fragment uit de aangeleverde artikeltekst — exact overgenomen (zelfde woorden, leestekens en volgorde). Verzin niets, parafraseer niet, vul niets aan. Kun je een element niet met een letterlijk fragment onderbouwen, neem het dan niet op.
- Geef bij twijfel tussen klassen `alternatieven`: de andere kandidaat-klasse(n) met een korte motivatie. Forceer geen zekerheid die er niet is.
- `lid`: het lidnummer waarin het fragment staat (bijv. "1"); leeg als het niet aan een lid te koppelen is.
- `toelichting`: één beknopte zin waarom deze klasse past (herleidbaar naar de herken-vraag).

UITVOER — geef UITSLUITEND geldige JSON terug, zonder omliggende tekst of code-fences, in deze vorm:
{{"elementen": [
  {{"klasse": "<een van: {klassen}>", "tekst": "<letterlijk fragment>", "lid": "<lidnummer of leeg>", "toelichting": "<één zin>", "alternatieven": [{{"klasse": "<klasse>", "motivatie": "<korte reden>"}}]}}
]}}
`alternatieven` mag een lege lijst zijn. Neem geen enkel element op waarvan `tekst` niet letterlijk in de aangeleverde artikeltekst voorkomt."""


def annotatie_userprompt(bwb_id: str, artikel: str, artikeltekst: str, lid: str | None = None) -> str:
    plek = f"artikel {artikel}" + (f" lid {lid}" if lid else "")
    scope = f" Blijf binnen lid {lid}." if lid else ""
    return (
        f"Regeling {bwb_id}, {plek}. Markeer en classificeer de JAS-elementen in onderstaande "
        f"tekst.{scope}\n\n--- ARTIKELTEKST ---\n{artikeltekst}\n--- EINDE ARTIKELTEKST ---"
    )


def critic_systeemprompt() -> str:
    klassen = ", ".join(JAS_KLASSEN_VOLGORDE)
    return f"""Je bent een kritische reviewer (Critic) die JAS-annotatievoorstellen controleert VÓÓRDAT een jurist ze beoordeelt. Je maakt de annotaties zelf NIET; je beoordeelt de kwaliteit ervan en signaleert waar de jurist extra op moet letten.

DE DERTIEN JAS-KLASSEN (gebruik exact deze namen, verzin geen andere):
{_klassen_referentie()}

WAAR JE OP LET (per voorgesteld element):
- Verkeerde of te grove klasse (past een andere JAS-klasse beter?).
- Zwak of onvolledig gemarkeerd fragment (te lang/te kort, verkeerde grens).
- Echte twijfel tussen klassen (dan hoort er disambiguatie te zijn).

AANDACHT-NIVEAU per element — géén verzonnen zekerheidscijfer, maar een oordeel op bovenstaande signalen:
- "groen": klasse en fragment zijn helder en juist; geen bezwaar.
- "geel": twijfel of een aandachtspunt — jurist moet even kijken (bv. plausibel alternatief, grensgeval).
- "rood": waarschijnlijk fout — verkeerde klasse of niet-onderbouwd fragment.

ONTBREKEND: benoem JAS-klassen die waarschijnlijk óók in de tekst voorkomen maar niet zijn gemarkeerd (met een korte reden). Verzin niets buiten de aangeleverde tekst.

UITVOER — geef UITSLUITEND geldige JSON terug, zonder omliggende tekst of code-fences, in deze vorm:
{{"oordelen": [
  {{"index": <0-based index van het element>, "aandacht": "<groen|geel|rood>", "motivatie": "<één korte zin>"}}
], "ontbrekend": [
  {{"klasse": "<een van: {klassen}>", "reden": "<korte reden>"}}
]}}
Geef voor ELK aangeleverd element precies één oordeel (met de juiste index). `ontbrekend` mag leeg zijn."""


def critic_userprompt(voorstellen: list[dict], artikeltekst: str) -> str:
    regels = []
    for i, v in enumerate(voorstellen):
        alt = ", ".join(a.get("klasse", "") for a in v.get("alternatieven", []) if a.get("klasse"))
        alt_tekst = f" | alternatieven: {alt}" if alt else ""
        regels.append(f'[{i}] klasse={v.get("klasse", "")} | tekst="{v.get("tekst", "")}"{alt_tekst}')
    lijst = "\n".join(regels) if regels else "(geen voorstellen)"
    return (
        "Beoordeel de onderstaande voorgestelde JAS-elementen tegen de artikeltekst. Geef per index een "
        "aandacht-niveau + motivatie, en noem waarschijnlijk ontbrekende elementen.\n\n"
        f"--- VOORSTELLEN ---\n{lijst}\n--- EINDE VOORSTELLEN ---\n\n"
        f"--- ARTIKELTEKST ---\n{artikeltekst}\n--- EINDE ARTIKELTEKST ---"
    )
