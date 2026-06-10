# Activiteit 3 — begrippen en afleidingsregels vaststellen

Activiteit 3 zet de geclassificeerde formuleringen uit activiteit 2 om in de *betekenis*:
herbruikbare begrippen (3a) en expliciete regels (3b). Doel is dat de uitvoering
(handmatig én geautomatiseerd) op de wet kan steunen en dat elke conclusie herleidbaar is
naar de bron.

## 3a — Begrippen maken

Een begrip is een unieke, herbruikbare betekeniseenheid die op een of meer gemarkeerde
formuleringen berust. Niet elke markering wordt een eigen begrip; gelijke of samenhangende
formuleringen leiden tot **één** begrip (dat is juist de winst: overzicht en samenhang).

Maak vooral begrippen bij de betekenisdragende klassen: **rechtssubjecten,
rechtsobjecten, rechtsbetrekkingen, rechtsfeiten** en de **variabelen** die daarbij horen.

Leg per begrip vast:

- **Begripsnaam** — kort, uniek, herkenbaar. Bij een rechtsbetrekking vaak een
  zelfstandig-naamwoordvorm van het werkwoord (bv. 'recht op zorgtoeslag').
- **Klasse** — de JAS-klasse waartoe het begrip hoort.
- **Definitie** — *hergebruik een brondefinitie letterlijk* als de wet de term definieert
  (verwijs naar het definitieartikel). Bestaat er geen wettelijke definitie, formuleer dan
  een heldere werkdefinitie op basis van de tekst en **markeer dit expliciet als
  interpretatie** (het is een keuze die validatie vraagt).
- **Voorbeeld** — een concreet, sprekend voorbeeld dat de definitie toetst en aanscherpt.
- **Kenmerken/relaties** — eigenschappen van het begrip en relaties met andere begrippen,
  gebaseerd op het JAS. Twee soorten:
  - *relatie:* een begrip verhoudt zich tot een ander begrip — bv. "rechtssubject
    *verzekerde* (begrip 1) is rechthebbende van rechtsbetrekking *recht op zorgtoeslag*
    (begrip 2)".
  - *kenmerk:* een eigenschap/variabele van het begrip — bv. "de ingangsdatum waarop de
    rechtsbetrekking geldig wordt".
- **Vindplaats / bron** — artikel + lid (+ bronreferentie) van de markering(en) waarop het
  begrip berust. Dit borgt de traceerbaarheid (en daarmee de rechtmatigheid).
- **Interpretatie/twijfel** — eventuele aannames of open punten bij dit begrip.

Vuistregels:
- Definieer een **rechtsbetrekking** altijd in termen van *wie* (rechthebbende én
  plichthebbende rechtssubject), *waarover* (rechtsobject) en *waardoor* (het rechtsfeit
  dat haar doet ontstaan).
- Houd **brondefinities** (wettelijk gedefinieerd) en **eigen begrippen** (door jou
  gevormd om formuleringen aan te duiden) uit elkaar.

## 3b — Afleidingsregels maken

Een afleidingsregel legt een in de wet besloten regel expliciet vast: een berekening, een
beslissing of een specialisatie, met de bijbehorende voorwaarden. Gebruik de begrippen uit
3a in samenhang.

Bepaal eerst het **type**:

- **Beslisregel** — leidt een ja/nee of waar/onwaar af (bv. "bestaat er recht op X?").
- **Rekenregel** — berekent een bedrag, hoogte of duur (de uitkomst van een rekensom).
- **Specialisatieregel** — bepaalt of een rechtssubject/rechtsobject tot een doelgroep
  behoort op basis van kenmerken (bv. "is deze persoon een 'verzekerde'?").

Leg per regel vast:

- **Naam** — wat de regel afleidt.
- **Type** — beslis / reken / specialisatie.
- **Uitvoervariabele** — de variabele die de regel vaststelt (de uitkomst).
- **Invoervariabelen** — de variabelen die de regel gebruikt (per geval verschillend).
- **Parameters** — de vaste waarden (tarieven, drempelbedragen, percentages) met hun
  parameterwaarde en geldigheidsperiode. Houd parameters strikt gescheiden van variabelen.
- **Voorwaarden** — de condities waaronder de regel geldt of een bepaalde uitkomst geeft,
  met de operatoren expliciet (cumulatief = EN, alternatief = OF, negatie = NIET).
- **Formulering** — een gestructureerde, leesbare weergave (pseudo) waarin operanden en
  operatoren expliciet zijn. Bijvoorbeeld:

  ```
  recht_op_zorgtoeslag (beslisregel) :=
      is_verzekerde = ja
      EN leeftijd >= 18
      EN toetsingsinkomen <= drempel_inkomen[jaar]
  ```

  ```
  hoogte_zorgtoeslag (rekenregel) :=
      normpremie - eigen_bijdrage(toetsingsinkomen, standaardpremie[jaar])
  ```

- **Vindplaats / bron** — artikel + lid (+ bronreferentie).
- **Interpretatie/twijfel** — aannames, open normen of delegaties die de regel onvolledig
  maken (bv. een drempelbedrag dat bij ministeriële regeling wordt vastgesteld → noteer dat
  de parameterwaarde uit de gedelegeerde regeling moet komen).

Vuistregels:
- Een afleidingsregel die naar een **gedelegeerde regeling** verwijst voor concrete waarden
  is pas compleet als die regeling is geanalyseerd. Maak de regel zo volledig mogelijk en
  signaleer het openstaande deel bij de validatiepunten.
- Een open norm ('redelijk', 'onverwijld', 'passende arbeid') laat zich niet sluitend in een
  regel vangen. Leg de norm vast als voorwaarde en markeer hem als interpretatiepunt voor de
  uitvoeringsbeleidsjurist — forceer geen schijnprecisie.
