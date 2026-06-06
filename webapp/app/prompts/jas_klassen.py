"""JAS-klassen definities voor de classificatie-prompt.

Gebaseerd op .claude/skills/wetsanalyse/references/jas-klassen.md
Dit bestand wordt gebruikt als context voor de LLM bij activiteit 2.
"""

JAS_KLASSEN = """
## De dertien JAS-klassen

Gebruik UITSLUITEND deze klassen. Verzin geen eigen klassen.

### 1. Rechtssubject
- **Omschrijving:** Drager van rechten/plichten; partij in een rechtsbetrekking.
- **Herken aan:** Zelfstandig naamwoord voor persoon/entiteit; 'hij', 'degene', 'een ieder', 'iemand'

### 2. Rechtsobject
- **Omschrijving:** Voorwerp van een rechtsbetrekking/rechtsfeit.
- **Herken aan:** Zelfstandig naamwoord (een woning, een dienst); 'dat', 'hetgeen', 'welk(e)'

### 3. Rechtsbetrekking
- **Omschrijving:** Juridische relatie tussen twee rechtssubjecten: de een heeft een plicht, de ander het recht.
- **Herken aan:** Werkwoord(combinatie): 'heeft recht op', 'heeft aanspraak op' (recht); 'stelt vast', 'moet', 'is verplicht', 'dient te' (plicht)

### 4. Rechtsfeit
- **Omschrijving:** Handeling, gebeurtenis of tijdsverloop dat een rechtsbetrekking creëert, wijzigt of beëindigt.
- **Herken aan:** Actieve werkwoordsvorm + zn: 'indienen van een bezwaarschrift', 'toekennen van een subsidie'

### 5. Voorwaarde
- **Omschrijving:** Conditie waaraan voldaan moet zijn voor een rechtsgevolg.
- **Herken aan:** Voorwaardelijke bijzin: 'indien', 'als', 'mits', 'tenzij', 'voor zover', 'met uitzondering van'

### 6. Afleidingsregel
- **Omschrijving:** Regel die nieuwe feiten/waarden afleidt (beslis-, reken- of specialisatieregel).
- **Herken aan:** 'verminderd met', 'vermeerderd met', 'bedraagt', 'wordt gesteld op', 'het gezamenlijke bedrag van'

### 7. Variabele(waarde)
- **Omschrijving:** Kenmerk dat per geval een andere waarde kan hebben (+ die waarde).
- **Herken aan:** Getal, datum, tekst, enumeratie (limitatieve opsomming) of booleaanse waarde (ja/nee)

### 8. Parameter(waarde)
- **Omschrijving:** Vaste waarde, gelijk voor allen over een periode (+ die waarde). 'Constante.'
- **Herken aan:** Tarief, percentage, (drempel)bedrag, vrijstelling met vaste waarde over een periode

### 9. Operator
- **Omschrijving:** Bewerking, vergelijking of logische verbinding.
- **Herken aan:** Reken: 'som van', 'vermeerderd met'; vergelijk: 'groter dan', 'gelijk aan'; logisch: 'en', 'of', 'niet'

### 10. Tijdsaanduiding
- **Omschrijving:** Tijdstip of tijdvak (geldigheid, peildatum, termijn).
- **Herken aan:** Concrete datum, 'kalenderjaar', 'maand', 'week'. Wint van variabele/parameter bij samenloop.

### 11. Plaatsaanduiding
- **Omschrijving:** Plaats/gebied dat het toepassingsbereik bepaalt.
- **Herken aan:** 'Nederland', 'de gemeente Amsterdam', 'een lidstaat van de EU'. Wint van variabele/parameter bij samenloop.

### 12. Delegatiebevoegdheid / -invulling
- **Omschrijving:** Bevoegdheid/opdracht om nadere regels te stellen (+ de regeling die dat invult).
- **Herken aan:** 'Bij (of krachtens) algemene maatregel van bestuur/ministeriële regeling worden regels gesteld' (verplicht); 'kunnen regels worden gesteld' (facultatief)

### 13. Brondefinitie
- **Omschrijving:** Begripsomschrijving die expliciet in de wet staat en een term eenduidig betekent.
- **Herken aan:** Definitieartikel vooraan de wet ('In deze wet wordt verstaan onder…')

## Vuistregels bij classificatie
- Bij samenloop kiest de meest specifieke klasse.
- 'bij of krachtens' in een delegatiebevoegdheid duidt op mogelijke subdelegatie (amvb → ministeriële regeling).
- Twijfel je tussen twee klassen? Kies de best passende, noteer het alternatief in de toelichting.
- Werk fijnmazig: een lid bevat vrijwel altijd meerdere markeringen.
"""
