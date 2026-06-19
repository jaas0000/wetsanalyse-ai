# Activiteit 3 — begrippen en afleidingsregels vaststellen

Activiteit 3 zet de geclassificeerde formuleringen uit activiteit 2 om in de *betekenis*:
herbruikbare begrippen (3a) en expliciete regels (3b). Doel is dat de uitvoering
(handmatig én geautomatiseerd) op de wet kan steunen en dat elke conclusie herleidbaar is
naar de bron.

## Werkgebied-breed: hergebruik en ontdubbeling

Activiteit 3 is **werkgebied-breed**: je bouwt één gedeelde begrippenlijst over **alle
bronnen** heen (niet per bron). Dat is de kern van de methode — een begrip wordt *hergebruikt*
voor elke formulering met dezelfde betekenis, ook als die in een andere bron of regeling staat.

- **Hergebruik (één begrip, meerdere vindplaatsen).** Komt dezelfde betekenis in meerdere
  bronnen voor, dan maak je niet twee begrippen maar één, met alle `vindplaatsen` opgesomd.
- **Synoniemen samenvoegen.** Verschillende formuleringen, dezelfde betekenis → één begrip met
  één **voorkeursterm** (`naam`) en de alternatieven in **`synoniemen`**. (Bv. *termijn* en
  *wettelijke aangiftetermijn* als ze hetzelfde betekenen.)
- **Homoniemen splitsen.** Dezelfde formulering, een andere betekenis → **aparte** begrippen.
  Leg de letterlijke **`grondformulering`** vast zodat de splitsing herleidbaar is. Klassiek
  voorbeeld: *bijdrage-inkomen* in Zvw art. 43 lid 1/2/3 → *berekend bijdrage-inkomen*,
  *bijdrage-inkomen na beoordeling op nihilstelling*, *…op maximumstelling*.
- **Begrip→begrip.** Gebruik in een begripsomschrijving al eerder gedefinieerde begrippen en
  noteer die in **`verwijst_naar_begrippen`** (de begrip-id's). Gebruik nooit het begrip zelf
  in zijn eigen omschrijving.
- **Aspecten uit andere bronnen.** Een formulering krijgt soms pas haar precieze betekenis uit
  een ander artikel/andere regeling (bv. *persoonsgebonden aftrek* uit een verwijzing). Neem
  die aspecten op in de definitie en kies zo nodig een betekenisvoller begrip.

## 3a — Begrippen maken

Een begrip is een unieke, herbruikbare betekeniseenheid die op een of meer gemarkeerde
formuleringen berust. Niet elke markering wordt een eigen begrip; gelijke of samenhangende
formuleringen leiden tot **één** begrip (dat is juist de winst: overzicht en samenhang).

Maak vooral begrippen bij de betekenisdragende klassen: **rechtssubjecten,
rechtsobjecten, rechtsbetrekkingen, rechtsfeiten** en de **variabelen** die daarbij horen.

Leg per begrip vast:

- **Begripsnaam (voorkeursterm)** — kort, uniek, herkenbaar; uniek per werkgebied. Bij een
  rechtsbetrekking vaak een zelfstandig-naamwoordvorm van het werkwoord (bv. 'recht op
  zorgtoeslag'). Alternatieve termen met dezelfde betekenis komen in **`synoniemen`**.
- **Klasse** — de JAS-klasse waartoe het begrip hoort.
- **Definitie** — *hergebruik een brondefinitie letterlijk* als de wet de term definieert
  (verwijs naar het definitieartikel). Staat die definitie in een **ander** artikel, dan heb
  je dat in stap 1b als verwijzing met functie *definitie* opgehaald: koppel het begrip
  daaraan met **`bron_verwijzing`** (het id van die verwijzing). Bestaat er geen wettelijke
  definitie, formuleer dan een heldere werkdefinitie op basis van de tekst en **markeer dit
  expliciet als interpretatie** (het is een keuze die validatie vraagt).
- **Voorbeeld** — een concreet, sprekend voorbeeld dat de definitie toetst en aanscherpt.
- **Kenmerken/relaties** — eigenschappen van het begrip en relaties met andere begrippen,
  gebaseerd op het JAS. Twee soorten:
  - *relatie:* een begrip verhoudt zich tot een ander begrip — bv. "rechtssubject
    *verzekerde* (begrip 1) is rechthebbende van rechtsbetrekking *recht op zorgtoeslag*
    (begrip 2)".
  - *kenmerk:* een eigenschap/variabele van het begrip — bv. "de ingangsdatum waarop de
    rechtsbetrekking geldig wordt".
- **Vindplaatsen** — de bron(nen) + lid waarop het begrip berust, als lijst
  `[{bron_id, lid}, …]` over de bronnen heen. Dit borgt de traceerbaarheid (en daarmee de
  rechtmatigheid) en maakt hergebruik zichtbaar.
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

Je **annoteert** de regel hier — wát hij afleidt (uitvoervariabele), waaruit (invoervariabelen
en parameters) en onder welke voorwaarden — maar je formuleert de regel niet uit in een
(pseudo)regeltaal. Die uitvoerbare formulering is de taak van de vervolgstap `regelspraak`
(GegevensSpraak + RegelSpraak); zo blijft er één bron van waarheid voor de regel zelf.

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
- **Vindplaatsen** — de bron(nen) + lid waarop de regel berust, als lijst `[{bron_id, lid}, …]`.
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
