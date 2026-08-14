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

ONTBREKEND: benoem JAS-klassen die waarschijnlijk óók in de tekst voorkomen maar niet zijn gemarkeerd.
- Geef ALTIJD het `tekst`-veld met het LETTERLIJKE fragment uit de artikeltekst dat gemarkeerd zou moeten worden — woord voor woord, zonder aanhalingstekens eromheen. Zonder fragment kan niemand er iets mee: de annotator kan het niet toevoegen (elk element moet letterlijk te vinden zijn) en de jurist moet het zelf gaan zoeken.
- Lukt dat echt niet omdat het element alleen impliciet aanwezig is (bv. een subject dat de tekst niet noemt), laat `tekst` dan leeg en begin de `reden` met "impliciet:". Zeg dus dát je het niet kunt aanwijzen in plaats van het te omschrijven alsof het er staat.
- Verzin niets buiten de aangeleverde tekst.

ACTIE per element — niet alleen wát er mis is, maar wat ermee moet gebeuren:
- "behoud": laat het element zoals het is (ook bij "geel": een aandachtspunt voor de jurist, geen correctie).
- "vervang": er is een betere klasse en/of een beter begrensd fragment. Geef die dan ook op in `voorstel_klasse` en/of `voorstel_tekst`; een `voorstel_tekst` MOET letterlijk in de artikeltekst staan.
- "verwijder": dit hoort helemaal geen JAS-element te zijn. Alleen bij "rood".

UITVOER — geef UITSLUITEND geldige JSON terug, zonder omliggende tekst of code-fences, in deze vorm:
{{"oordelen": [
  {{"id": "<het id van het element>", "aandacht": "<groen|geel|rood>", "motivatie": "<één korte zin>",
    "actie": "<behoud|vervang|verwijder>", "voorstel_klasse": "<optioneel, een van de dertien>",
    "voorstel_tekst": "<optioneel, letterlijk fragment>"}}
], "ontbrekend": [
  {{"klasse": "<een van: {klassen}>", "reden": "<korte reden>", "tekst": "<optioneel, letterlijk fragment>"}}
]}}
Geef voor ELK aangeleverd element precies één oordeel, met het `id` zoals het is aangeleverd. `ontbrekend` mag leeg zijn.

ELEMENTEN GEMARKEERD MET "DOOR DE JURIST" heeft een mens zelf aangebracht. Beoordeel ze net zo eerlijk, maar weet dat je oordeel daar een SUGGESTIE is die de jurist naast zich neer mag leggen: gebruik `actie: "behoud"` tenzij je echt denkt dat er iets mis is, en formuleer de motivatie als een vraag of overweging, niet als een correctie."""


def critic_userprompt(voorstellen: list[dict], artikeltekst: str) -> str:
    regels = []
    for i, v in enumerate(voorstellen):
        alt = ", ".join(a.get("klasse", "") for a in v.get("alternatieven", []) if a.get("klasse"))
        alt_tekst = f" | alternatieven: {alt}" if alt else ""
        # Zowel het id (waarop het oordeel wordt gekoppeld) als de positie: valt het id weg in de
        # respons, dan is er nog een terugval. Zie `_verwerk_critic`.
        eigen_id = v.get("id", "") or f"pos-{i}"
        # Markeringen van de jurist krijgen een label: de Critic mag er iets van vinden, maar zijn
        # oordeel wordt daar een SUGGESTIE — de mens heeft het laatste woord.
        merk = " | DOOR DE JURIST" if v.get("van_jurist") else ""
        regels.append(
            f'[{i}] id={eigen_id} | klasse={v.get("klasse", "")} | tekst="{v.get("tekst", "")}"{alt_tekst}{merk}'
        )
    lijst = "\n".join(regels) if regels else "(geen voorstellen)"
    return (
        "Beoordeel de onderstaande voorgestelde JAS-elementen tegen de artikeltekst. Geef per element "
        "een aandacht-niveau, een motivatie en een actie, en noem waarschijnlijk ontbrekende elementen.\n\n"
        f"--- VOORSTELLEN ---\n{lijst}\n--- EINDE VOORSTELLEN ---\n\n"
        f"--- ARTIKELTEKST ---\n{artikeltekst}\n--- EINDE ARTIKELTEKST ---"
    )


def herziening_systeemprompt() -> str:
    """Systeemprompt voor de herzieningsronde: dezelfde JAS-regels, maar nu corrigerend."""
    return f"""Je bent dezelfde JAS-annotator als daarvoor, maar nu HERZIE je je eigen eerdere uitkomst op basis van de opmerkingen van een reviewer (de Critic).

DE DERTIEN JAS-KLASSEN (gebruik exact deze namen, verzin geen andere):
{_klassen_referentie()}

BRONGETROUWHEID — elk `tekst`-veld moet een LETTERLIJK aaneengesloten fragment uit de artikeltekst zijn. Niet parafraseren, niet samenvatten, geen woorden toevoegen of weglaten. Een fragment dat niet letterlijk voorkomt wordt verworpen.

HOE JE HERZIET:
- Behoud het `id` van een bestaand element dat je aanpast. Zonder dat id raakt het werk van de jurist aan dit element verloren.
- Volg de opmerkingen van de reviewer waar je het ermee eens bent. Ben je het gemotiveerd oneens, laat het element dan staan zoals het was.
- Elementen waar niets over is opgemerkt geef je ONGEWIJZIGD terug, met hun oorspronkelijke id.
- Is er een element gemeld als ontbrekend? Voeg het toe met een letterlijk fragment, en laat `id` leeg.
- Fragmenten die eerder zijn verworpen omdat ze niet letterlijk in de tekst staan: zoek het bedoelde fragment op en markeer dát, of laat het element weg.

UITVOER — geef UITSLUITEND geldige JSON terug, zonder omliggende tekst of code-fences:
{{"elementen": [
  {{"id": "<het bestaande id, of leeg bij een nieuw element>",
    "klasse": "<een van de dertien>",
    "tekst": "<letterlijk fragment>",
    "lid": "<lidnummer of leeg>",
    "toelichting": "<één zin: waarom deze klasse>",
    "alternatieven": [{{"klasse": "<andere klasse>", "motivatie": "<waarom twijfel>"}}]}}
]}}"""


def herziening_userprompt(
    voorstellen: list[dict],
    feedback: list[dict],
    ontbrekend: list[dict],
    verworpen: list[dict],
    artikeltekst: str,
) -> str:
    op_id = {f.get("id"): f for f in feedback}
    regels = []
    for v in voorstellen:
        f = op_id.get(v.get("id")) or {}
        actie = f.get("actie", "behoud")
        deel = f'[id={v.get("id", "")}] klasse={v.get("klasse", "")} | tekst="{v.get("tekst", "")}"'
        if f:
            deel += f'\n    reviewer ({f.get("aandacht", "")}): {f.get("motivatie", "")}'
            if actie == "vervang":
                voorstel = []
                if f.get("voorstel_klasse"):
                    voorstel.append(f'klasse → {f["voorstel_klasse"]}')
                if f.get("voorstel_tekst"):
                    voorstel.append(f'tekst → "{f["voorstel_tekst"]}"')
                deel += f'\n    → VERVANG: {"; ".join(voorstel)}'
            elif actie == "verwijder":
                deel += "\n    → VERWIJDER dit element (laat het weg uit je uitvoer)"
            else:
                deel += "\n    → behouden zoals het is"
        else:
            deel += "\n    → geen opmerkingen; ongewijzigd teruggeven"
        regels.append(deel)

    blokken = [
        "Herzie je eerdere JAS-annotatie op basis van de opmerkingen hieronder.",
        "",
        "--- JE EERDERE ELEMENTEN + OPMERKINGEN ---",
        "\n".join(regels) if regels else "(geen)",
        "--- EINDE ---",
    ]
    if ontbrekend:
        gemist = "\n".join(
            f'- {o.get("klasse", "")}: {o.get("reden", "")}'
            + (f' (fragment: "{o["tekst"]}")' if o.get("tekst") else "")
            for o in ontbrekend
        )
        blokken += ["", "--- MOGELIJK GEMIST (voeg toe als je het eens bent) ---", gemist, "--- EINDE ---"]
    if verworpen:
        # Dit is de goedkoopste kwaliteitswinst: een bijna-goed citaat is met deze aanwijzing
        # prima te repareren, terwijl het anders stilzwijgend verdween.
        weg = "\n".join(
            f'- {v.get("klasse", "")}: "{v.get("tekst", "")}" '
            + ("(staat niet letterlijk in de tekst)" if v.get("reden") == "niet_letterlijk" else "(ongeldige klasse)")
            for v in verworpen
        )
        blokken += ["", "--- EERDER VERWORPEN ---", weg, "--- EINDE ---"]
    blokken += ["", f"--- ARTIKELTEKST ---\n{artikeltekst}\n--- EINDE ARTIKELTEKST ---"]
    return "\n".join(blokken)
