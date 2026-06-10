---
name: wetsanalyse
description: >-
  Voert Wetsanalyse uit op Nederlandse wet- en regelgeving volgens de methode
  Wetsanalyse (Ausems, Bulles & Lokin) en het Juridisch Analyseschema (JAS):
  activiteit 2 (wetsformuleringen markeren en classificeren in JAS-klassen) en
  activiteit 3 (begrippen en afleidingsregels vaststellen), met een traceerbaar
  Markdown-analyserapport als resultaat. Gebruik deze skill zodra de gebruiker een
  wetsartikel of regeling juridisch wil analyseren, structureren, ontleden of
  "wetsanalyse" wil doen — ook bij vragen als "classificeer dit artikel", "welke
  rechtssubjecten/rechtsbetrekkingen/voorwaarden zitten hierin", "maak begrippen en
  afleidingsregels bij artikel X", "ontleed deze bepaling juridisch", of wanneer een
  bepaling brongetrouw en uitlegbaar moet worden vastgelegd voor uitvoering
  (bijvoorbeeld bij de Belastingdienst). Haalt de wettekst zelf op via de
  wettenbank-MCP. Trigger ook bij twijfel: dit is de aangewezen werkwijze voor het
  gestructureerd duiden van de betekenis van wetgeving.
---

# Wetsanalyse (activiteit 2 + 3)

## Wat dit is en waarom het zo werkt

Wetsanalyse is een gestructureerde methode om de betekenis van wetgeving expliciet,
traceerbaar en uitlegbaar te maken, zodat besluiten in de uitvoering te verantwoorden
zijn. Deze skill voert de analytische kern uit:

- **Activiteit 2 — juridische structuur zichtbaar maken**: relevante wetsformuleringen
  *markeren* (2a) en elke markering een *klasse* uit het Juridisch Analyseschema (JAS)
  geven (2b).
- **Activiteit 3 — betekenis vaststellen**: van de geclassificeerde formuleringen
  *begrippen* maken (3a, met definitie, voorbeeld, kenmerken/relaties) en *afleidingsregels*
  vastleggen (3b: beslis-, reken- en specialisatieregels en de voorwaarden daarbij).

Het resultaat is één traceerbaar Markdown-analyserapport.

Na activiteit 2 en na activiteit 3 pauzeert de skill voor een **review-checkpoint**: de
analist valideert de tussenresultaten in een lokale reviewpagina en geeft per onderdeel of
in het algemeen feedback, die je verwerkt voordat je verdergaat (zie stap 2b, 3b en
`references/review-checkpoints.md`).

**Dit is een hulpmiddel, geen vervanger van de analist.** De methode draait om het
*expliciet maken van interpretatiekeuzes* zodat juristen, informatieanalisten en
ICT-ontwikkelaars er samen over kunnen beslissen. Lever dus een onderbouwd, eerlijk
concept op: classificeer wat helder is, en markeer twijfel, aannames en open normen
als zodanig in plaats van een schijnzekerheid te produceren. Een goede analyse die haar
eigen onzekerheden benoemt is waardevoller dan een gladde die ze verbergt.

## Brongetrouwheid is niet onderhandelbaar

In een professionele uitvoeringscontext (zoals de Belastingdienst) hangt rechtmatigheid
aan de bron. Daarom:

- **Werk alleen met de letterlijke, opgehaalde wettekst.** Verzin nooit tekst, leden of
  artikelnummers. Citeer formuleringen letterlijk.
- **Houd alles herleidbaar.** Elke markering, elk begrip en elke afleidingsregel verwijst
  naar de vindplaats (artikel + lid) en, waar beschikbaar, de `bronreferentie` (jci-link)
  uit de MCP.
- **Gebruik uitsluitend de dertien JAS-klassen** hieronder. Verzin geen eigen klassen.

## Stap 1 — Wettekst ophalen via de wettenbank-MCP

De gebruiker geeft doorgaans een wetsnaam + artikel(en). Haal de actuele tekst zelf op;
laat de gebruiker niet plakken tenzij de MCP onbeschikbaar is.

Aanbevolen volgorde:

1. `wettenbank_zoek` (op `titel`, evt. `rechtsgebied`/`ministerie`) → bepaal het **BWB-id**.
2. `wettenbank_structuur` (met `bwbId`) → controleer het juiste artikelnummer en het pad
   in de wet. Doe dit ook om aangrenzende/definitie-artikelen te vinden die de betekenis
   bepalen (zie hieronder).
3. `wettenbank_artikel` (`bwbId` + `artikel`, evt. `lid`) → haal de letterlijke tekst,
   `leden`, `pad` en `bronreferentie` op.

Gebruik `wettenbank_zoekterm` om binnen een wet te vinden waar een begrip nog meer
voorkomt, of om **brondefinities** op te sporen (een gedefinieerde term staat vaak in een
apart definitieartikel vooraan de wet — haal dat artikel erbij, want het bepaalt de
betekenis van de bepaling die je analyseert).

Als de MCP niet beschikbaar is, zeg dat eerlijk en werk verder met door de gebruiker
aangeleverde tekst, met dezelfde brongetrouwheid.

## Stap 2 — Activiteit 2: markeren en classificeren

Lees de tekst lid voor lid. Identificeer samenhangende formuleringen (2a) en ken elk een
JAS-klasse toe (2b). Werk fijnmazig: een lid bevat vrijwel altijd meerdere markeringen.

Gebruik per klasse de **herkenningsvraag** als grammaticale ontleedvraag op de tekst. Dit
is de compacte checklist; voor de volledige omschrijving, herkenningsvragen en
uitdrukkingswijzen zie `references/jas-klassen.md` (raadpleeg bij twijfel of bij
samenloop van klassen).

| Klasse | Kern | Herken aan |
| --- | --- | --- |
| **Rechtssubject** | Drager van rechten/plichten; partij in een rechtsbetrekking. *Wie heeft het recht/de plicht?* | Zelfstandig naamwoord voor persoon/entiteit; 'hij', 'degene', 'een ieder', 'iemand' |
| **Rechtsobject** | Voorwerp van een rechtsbetrekking/rechtsfeit. *Waar gaat het recht/de plicht over?* | Zelfstandig naamwoord (een woning, een dienst); 'dat', 'hetgeen', 'welk(e)' |
| **Rechtsbetrekking** | Juridische relatie tussen twee rechtssubjecten: de een heeft een plicht, de ander het recht. | Werkwoord(combinatie): 'heeft recht op', 'heeft aanspraak op' (recht); 'stelt vast', 'moet', 'is verplicht', 'dient te' (plicht) |
| **Rechtsfeit** | Handeling, gebeurtenis of tijdsverloop dat een rechtsbetrekking creëert, wijzigt of beëindigt. | Actieve werkwoordsvorm + zn: 'indienen van een bezwaarschrift', 'toekennen van een subsidie' |
| **Voorwaarde** | Conditie waaraan voldaan moet zijn voor een rechtsgevolg. *Welke eis wordt gesteld?* | Voorwaardelijke bijzin: 'indien', 'als', 'mits', 'tenzij', 'voor zover', 'met uitzondering van' |
| **Afleidingsregel** | Regel die nieuwe feiten/waarden afleidt (beslis-, reken- of specialisatieregel). *Hoe wordt iets berekend/bepaald?* | 'verminderd met', 'vermeerderd met', 'bedraagt', 'wordt gesteld op', 'het gezamenlijke bedrag van' |
| **Variabele(waarde)** | Kenmerk dat per geval een andere waarde kan hebben (+ die waarde). | Getal, datum, tekst, enumeratie (limitatieve opsomming) of booleaanse waarde (ja/nee) |
| **Parameter(waarde)** | Vaste waarde, gelijk voor allen over een periode (+ die waarde). 'Constante.' | Tarief, percentage, (drempel)bedrag, vrijstelling met vaste waarde over een periode |
| **Operator** | Bewerking, vergelijking of logische verbinding. | Reken: 'som van', 'vermeerderd met'; vergelijk: 'groter dan', 'gelijk aan'; logisch: 'en', 'of', 'niet', 'ten minste' |
| **Tijdsaanduiding** | Tijdstip of tijdvak (geldigheid, peildatum, termijn). | Concrete datum, 'kalenderjaar', 'maand', 'week'. *Meest specifieke klasse: wint van variabele/parameter.* |
| **Plaatsaanduiding** | Plaats/gebied dat het toepassingsbereik bepaalt. | 'Nederland', 'de gemeente Amsterdam', 'een lidstaat van de EU'. *Wint ook van variabele/parameter.* |
| **Delegatiebevoegdheid / -invulling** | Bevoegdheid/opdracht om nadere regels te stellen (+ de regeling die dat invult). | 'Bij (of krachtens) algemene maatregel van bestuur/ministeriële regeling worden regels gesteld' (verplicht); 'kunnen regels worden gesteld' (facultatief) |
| **Brondefinitie** | Begripsomschrijving die expliciet in de wet staat en een term eenduidig betekent. | Definitieartikel vooraan de wet ('In deze wet wordt verstaan onder…') |

Vuistregels bij het classificeren:

- **Bij samenloop kiest de meest specifieke klasse.** Een datum die de geldigheid duidt is
  een *tijdsaanduiding*, geen variabele; een gebied is een *plaatsaanduiding*.
- **'bij of krachtens'** in een delegatiebevoegdheid duidt op mogelijke subdelegatie
  (amvb → ministeriële regeling). Noteer dat: de gedelegeerde regeling hoort tot het
  werkgebied en moet later apart geanalyseerd worden.
- **Twijfel je tussen twee klassen?** Kies de best passende, noteer het alternatief in de
  toelichting, en neem het op bij de validatiepunten (stap 4). Forceer niets.

Vat daarna kort samen hoe de klassen *samenhangen* rond de centrale klassen
(rechtsbetrekking en rechtsfeit): wie is rechthebbende, wie plichthebbende, welk
rechtsobject, onder welke voorwaarden. Dit is de "structuur" die activiteit 2 zichtbaar
maakt.

## Stap 2b — Review-checkpoint na activiteit 2

Wetsanalyse is multidisciplinair werk: de analist (jurist/informatieanalist) hoort de
markeringen en classificaties te valideren vóórdat je betekenis gaat vaststellen. Dit is
een **iteratieve lus**: je verwerkt feedback en toont het herziene resultaat opnieuw, tot
de analist akkoord is zonder opmerkingen. Zo kan de analist controleren of zijn correcties
geland zijn. Lees `references/review-checkpoints.md` voor het datacontract; in het kort,
met `N` = rondenummer (start op 1):

1. Schrijf het tussenresultaat naar `werk/activiteit-2/ronde-{N}/analyse.json` (markeringen
   met **stabiele id's**, leden-tekst, samenhang) volgens het schema in de referentie.
   Overschrijf eerdere rondes niet; houd id's gelijk aan de vorige ronde.
2. Start de review-server in de achtergrond. Ronde 1:
   `python "<skill>/scripts/review_server.py" --input werk/activiteit-2/ronde-1/analyse.json --activiteit 2 --feedback-out werk/activiteit-2/ronde-1/feedback.json --ronde 1`
   Ronde 2+: voeg `--ronde {N}` en `--vorige werk/activiteit-2/ronde-{N-1}` toe, zodat de
   analist per item zijn vorige feedback en de vorige versie ziet.
3. Geef de analist de URL (`http://localhost:3118`) en **rond je beurt af**: vraag de
   analist de review te bekijken, per item of in het algemeen feedback te geven, en
   **"Akkoord"** of **"Verstuur feedback"** te klikken. Ga niet zelf verder.
4. Zodra de analist bevestigt dat die klaar is: lees `werk/activiteit-2/ronde-{N}/feedback.json`.
   - Bij `akkoord` **zonder** items en **zonder** algemene feedback: stop de server, de lus
     is klaar — ga door naar activiteit 3.
   - Anders: verwerk **elke** per-item-correctie en de algemene feedback (herclassificeren,
     toelichting bijstellen, markeringen toevoegen/verwijderen), stop de server, verhoog `N`
     en ga terug naar stap 1. Noteer per ronde wat je wijzigde voor de reviewlog.
5. **Veiligheidscap:** stop na maximaal 6 rondes, ook als er nog feedback is; meld dit en
   neem de resterende punten op bij de aandachtspunten voor validatie.

Sla deze hele lus alleen over als `WETSANALYSE_NO_REVIEW=1` in de omgeving staat (alleen
voor geautomatiseerde tests): schrijf dan één keer `ronde-1/analyse.json` en noteer in het
rapport dat de reviews zijn overgeslagen.

## Stap 3 — Activiteit 3: begrippen en afleidingsregels

Lees `references/activiteit-3-vuistregels.md` voordat je begrippen en regels opstelt; dat
bevat de werkwijze en voorbeelden. In het kort:

**3a Begrippen.** Maak per uniek, betekenisdragend element (vooral rechtssubjecten,
rechtsobjecten, rechtsbetrekkingen, rechtsfeiten en variabelen) een begrip met: een
unieke **begripsnaam**, een **definitie** (hergebruik een *brondefinitie* letterlijk als
die er is; anders formuleer je een werkdefinitie en markeer je dat als interpretatie), een
kort **voorbeeld**, en **kenmerken/relaties** (bv. "rechtssubject X is rechthebbende van
rechtsbetrekking Y"). Elk begrip verwijst naar de markering(en) en vindplaats waarop het
berust (traceerbaarheid).

**3b Afleidingsregels.** Leg per regel vast: een **naam**, het **type** (beslisregel →
ja/nee of waar/onwaar; rekenregel → een berekend bedrag/getal; specialisatieregel →
behoort tot doelgroep), de **uitvoervariabele**, de **invoervariabelen** en **parameters**,
de **voorwaarden**, en een gestructureerde **formulering** (leesbaar pseudo, met de
operatoren expliciet). Verwijs naar de bron. Houd parameters (vaste waarden) en variabelen
(per geval verschillend) uit elkaar.

## Stap 3b — Review-checkpoint na activiteit 3

Net als na activiteit 2: laat de begrippen en afleidingsregels door de analist valideren
voordat je het eindrapport opmaakt — als dezelfde **iteratieve lus**, tot akkoord zonder
opmerkingen (zie `references/review-checkpoints.md`). Met `N` = rondenummer:

1. Schrijf `werk/activiteit-3/ronde-{N}/analyse.json` (begrippen + afleidingsregels met
   **stabiele id's**, concept-validatiepunten). Overschrijf eerdere rondes niet.
2. Start de server met `--input werk/activiteit-3/ronde-{N}/analyse.json --activiteit 3
   --feedback-out werk/activiteit-3/ronde-{N}/feedback.json --ronde {N}`; vanaf ronde 2 ook
   `--vorige werk/activiteit-3/ronde-{N-1}`.
3. Geef de URL, **pauzeer**, en wacht op bevestiging van de analist.
4. Lees `werk/activiteit-3/ronde-{N}/feedback.json`. Bij `akkoord` zonder items en zonder
   algemene feedback: stop de server, de lus is klaar. Anders: verwerk de feedback, stop de
   server, verhoog `N` en herhaal vanaf stap 1. Noteer de wijzigingen per ronde voor de
   reviewlog. Veiligheidscap: maximaal 6 rondes.

Dezelfde `WETSANALYSE_NO_REVIEW=1`-uitzondering geldt (één keer `ronde-1/analyse.json`
schrijven, lus overslaan).

## Stap 4 — Rapport opstellen

Het rapport bestaat uit een `rapport.json` (primaire bron) die via een lokale HTML-viewer
wordt getoond. De Markdown-versie is beschikbaar als downloadknop in die viewer. Volg
onderstaande stappen precies; type niets over uit de analyse.json's.

**Stap 4a — Bouw rapport.json (zonder vrije tekstvelden)**

```bash
python "<skill>/scripts/build_rapport_json.py" \
  --werk <werkmap> \
  --out  <analysemap>/rapport.json
```

Het script kiest per activiteit automatisch de hoogste ronde en combineert act-2 en act-3
tot één `rapport.json`. De drie vrije tekstvelden (reviewlog act. 2, reviewlog act. 3,
aandachtspunten) zijn nog leeg; het script meldt hoeveel er ontbreken.

**Stap 4b — Genereer de vrije tekstvelden**

Schrijf op basis van de feedback.json's en de validatiepunten in act-3:

1. **Reviewlog activiteit 2** — wat is per ronde gewijzigd op grond van de feedback?
   Bij 1 ronde direct akkoord: `"1 ronde — direct akkoord, geen wijzigingen."`.
   Was de review overgeslagen via `WETSANALYSE_NO_REVIEW=1`: noteer dat expliciet.
2. **Reviewlog activiteit 3** — idem voor activiteit 3.
3. **Aandachtspunten voor multidisciplinaire validatie** — gestructureerde synthese
   van de interpretatiekeuzes, open normen, openstaande delegaties, aannames en wat
   buiten scope valt. Gebruik de `validatiepunten`-array uit act-3 en de `twijfel`-velden
   in de markeringen, begrippen en afleidingsregels als bronmateriaal. Dit is geen bijzaak
   — het is wat de analyse bruikbaar en eerlijk maakt als hulpmiddel.

**Stap 4c — Voeg de vrije tekstvelden in**

```bash
python "<skill>/scripts/build_rapport_json.py" \
  --werk <werkmap> \
  --out  <analysemap>/rapport.json \
  --reviewlog-act2  "<tekst uit stap 4b>" \
  --reviewlog-act3  "<tekst uit stap 4b>" \
  --aandachtspunten "<tekst uit stap 4b>"
```

**Stap 4d — Start de rapport-viewer**

```bash
python "<skill>/scripts/rapport_server.py" \
  --input <analysemap>/rapport.json
```

Voeg `--no-browser` toe als `WETSANALYSE_NO_REVIEW=1` in de omgeving staat.

Geef de analist de URL (`http://localhost:3119`) en **pauzeer**: vraag de analist het
rapport te bekijken, eventueel de §4-velden bij te stellen en op **Opslaan** te klikken,
en de Markdown te downloaden via **Download Markdown**. Ga niet zelf door tot de analist
bevestigt. De analist stopt de server zelf via Ctrl+C in de terminal.

Na bevestiging van de analist is het rapport gereed.

## Kwaliteitscheck voordat je oplevert

- Is elke markering, elk begrip en elke regel herleidbaar naar artikel + lid (en
  bronreferentie)?
- Zijn alle klassen uit het JAS, en geen verzonnen klassen?
- Zijn brondefinities opgehaald en hergebruikt waar de bepaling naar gedefinieerde termen
  verwijst?
- Zijn interpretatiekeuzes en twijfel expliciet benoemd in plaats van weggepoetst?
- Zijn beide iteratieve review-checkpoints doorlopen tot de analist akkoord was zonder
  opmerkingen (of bewust overgeslagen via `WETSANALYSE_NO_REVIEW`), en is de feedback per
  ronde verwerkt en in de reviewlog vastgelegd?
- Klopt de letterlijke wettekst met de bron (geen parafrase als citaat)?

## Diagnose bij falen

Dit gaat **niet** over gewone review-feedback: feedback die niet meteen "akkoord" is, is het
normale proces — verwerk die in de volgende ronde (stap 2b/3b). Maar gaat het om
*onbetrouwbaarheid of storing* — verzonnen wettekst, een niet-bestaande JAS-klasse, een
overgeslagen reviewstop, een MCP die niets teruggeeft, of een lus die niet convergeert —
verdenk dan niet het model maar de harness eromheen. Loop de vier hendels langs: Context
(wat zag het model?), Tools (wat kon het doen?), Loop (hoe bewoog het?) en Governance (wat
hield het in toom?). Gebruik de symptoom→hendel-tabel in `references/harness-diagnose.md`.
