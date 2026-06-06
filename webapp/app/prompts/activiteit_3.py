"""Activiteit 3 vuistregels voor de betekenis-prompt.

Gebaseerd op .claude/skills/wetsanalyse/references/activiteit-3-vuistregels.md
"""

ACTIVITEIT_3_VUISTREGELS = """
## 3a — Begrippen maken

Een begrip is een unieke, herbruikbare betekeniseenheid die op een of meer gemarkeerde
formuleringen berust. Niet elke markering wordt een eigen begrip; gelijke of samenhangende
formuleringen leiden tot ÉÉN begrip.

Maak vooral begrippen bij de betekenisdragende klassen: rechtssubjecten,
rechtsobjecten, rechtsbetrekkingen, rechtsfeiten en de variabelen die daarbij horen.

Per begrip:
- **Begripsnaam** — kort, uniek, herkenbaar. Bij een rechtsbetrekking vaak een
  zelfstandig-naamwoordvorm van het werkwoord (bv. 'recht op zorgtoeslag').
- **Klasse** — de JAS-klasse waartoe het begrip hoort.
- **Definitie** — hergebruik een brondefinitie letterlijk als de wet de term definieert
  (verwijs naar het definitieartikel). Bestaat er geen wettelijke definitie, formuleer
  dan een heldere werkdefinitie op basis van de tekst en markeer dit expliciet als
  interpretatie (het is een keuze die validatie vraagt).
- **Voorbeeld** — een concreet, sprekend voorbeeld dat de definitie toetst.
- **Kenmerken/relaties** — eigenschappen van het begrip en relaties met andere begrippen.
- **Vindplaats / bron** — artikel + lid (+ bronreferentie) van de markering(en).
- **Interpretatie/twijfel** — eventuele aannames of open punten.

Vuistregels:
- Definieer een rechtsbetrekking altijd in termen van WIE (rechthebbende én plichthebbende
  rechtssubject), WAAROVER (rechtsobject) en WAARDOOR (het rechtsfeit dat haar doet ontstaan).
- Houd brondefinities (wettelijk gedefinieerd) en eigen begrippen (door jou gevormd)
  uit elkaar.

## 3b — Afleidingsregels maken

Een afleidingsregel legt een in de wet besloten regel expliciet vast.

Bepaal eerst het type:
- **Beslisregel** — leidt een ja/nee of waar/onwaar af.
- **Rekenregel** — berekent een bedrag, hoogte of duur.
- **Specialisatieregel** — bepaalt of een rechtssubject/rechtsobject tot een doelgroep behoort.

Per regel:
- **Naam** — wat de regel afleidt.
- **Type** — beslis / reken / specialisatie.
- **Uitvoervariabele** — de variabele die de regel vaststelt.
- **Invoervariabelen** — de variabelen die de regel gebruikt (per geval verschillend).
- **Parameters** — de vaste waarden (tarieven, drempelbedragen, percentages) met hun
  waarde en geldigheidsperiode. Houd parameters strikt gescheiden van variabelen.
- **Voorwaarden** — de condities waaronder de regel geldt, met operatoren expliciet
  (cumulatief = EN, alternatief = OF, negatie = NIET).
- **Formulering** — een gestructureerde, leesbare weergave (pseudo) waarin operanden
  en operatoren expliciet zijn.
- **Vindplaats / bron** — artikel + lid (+ bronreferentie).
- **Interpretatie/twijfel** — aannames, open normen of delegaties.

Vuistregels:
- Een afleidingsregel die naar een gedelegeerde regeling verwijst is pas compleet
  als die regeling is geanalyseerd. Signaleer het openstaande deel.
- Een open norm ('redelijk', 'onverwijld', 'passende arbeid') laat zich niet sluitend
  in een regel vangen. Leg de norm vast als voorwaarde en markeer hem als interpretatiepunt.
"""
