# Review-checkpoints — datacontract en werkwijze

Na activiteit 2 en na activiteit 3 pauzeert de skill voor een review door de analist
(human-in-the-loop). Dit bestand beschrijft hoe je het tussenresultaat wegschrijft, de
review-server start, en de feedback verwerkt.

Waarom: Wetsanalyse is een multidisciplinaire, iteratieve methode. De betekenis van
wetgeving — en zeker de interpretatiekeuzes — moeten door mensen (jurist,
informatieanalist, ICT) worden gevalideerd vóórdat de analyse de uitvoering in gaat. De
review-momenten maken die validatie expliciet en traceerbaar.

## Werkmap — één map per ronde

De review is **iteratief**: na elke ronde feedback verwerk je en toon je het herziene
resultaat opnieuw. Bewaar daarom de volledige historie — overschrijf niets. Schrijf naar
een werkmap bij het eindrapport (`werk/`), met per activiteit een submap en daarin per
ronde een map met twee vaste bestanden:

```
werk/
  activiteit-2/
    ronde-1/  analyse.json  feedback.json
    ronde-2/  analyse.json  feedback.json
    ...
  activiteit-3/
    ronde-1/  analyse.json  feedback.json
    ...
```

- `ronde-N/analyse.json` — tussenresultaat van die ronde (jij schrijft dit).
- `ronde-N/feedback.json` — feedback van de analist op die ronde (de viewer schrijft dit).

Het auditspoor laat zo zien hoe de analyse onder de feedback van de analist evolueerde —
dat past bij de traceerbaarheidseis van het project.

## Schema — `analyse.json` (activiteit 2)

```json
{
  "wet": "Wet op de zorgtoeslag",
  "bwbId": "BWBR0018451",
  "artikel": "2",
  "versiedatum": "2026-01-01",
  "bronreferentie": "jci1.3:c:BWBR0018451&artikel=2",
  "type": "wet",
  "pad": "Hoofdstuk 1 > Artikel 2",
  "analysefocus": "<hoofdvraag, of weglaten voor volledige analyse>",
  "reikwijdte": "<welke leden zijn geanalyseerd; wat valt buiten scope>",
  "geraadpleegde": "<definitie-/aanpalende artikelen, bv. art. 1 (begripsbepalingen)>",
  "leden": [{ "lid": "1", "tekst": "<letterlijke wettekst van het lid>" }],
  "markeringen": [
    {
      "id": "m1",
      "formulering": "<letterlijke formulering>",
      "klasse": "Rechtssubject",
      "vindplaats": "lid 1",
      "toelichting": "<waarom deze klasse; evt. alternatief>"
    }
  ],
  "samenhang": "<korte tekst over samenhang rond rechtsbetrekking/rechtsfeit>"
}
```

De velden `type`, `pad`, `analysefocus`, `reikwijdte` en `geraadpleegde` voeden sectie 0
(Bron en afbakening) van het eindrapport. `pad` en `type` komen uit `wettenbank_artikel` /
`wettenbank_structuur`; `analysefocus`/`reikwijdte`/`geraadpleegde` leg je vast uit de
opdracht en je afbakening. Ze zijn optioneel: ontbreken ze, dan geeft `build_rapport_json.py`
ze als lege string door aan `rapport.json`, waarna je ze in de HTML-viewer (de §4-velden van
`rapport_server.py`) bijstelt.

## Schema — `analyse.json` (activiteit 3)

```json
{
  "wet": "...", "bwbId": "...", "artikel": "...", "versiedatum": "...",
  "bronreferentie": "...",
  "begrippen": [
    {
      "id": "b1", "naam": "verzekerde", "klasse": "Rechtssubject",
      "definitie": "<brondefinitie of [interpretatie]>",
      "voorbeeld": "...", "kenmerken": "<kenmerken/relaties>",
      "vindplaats": "art. 1 onder c; art. 2 lid 1", "twijfel": "..."
    }
  ],
  "afleidingsregels": [
    {
      "id": "r1", "naam": "recht op zorgtoeslag", "type": "beslisregel",
      "uitvoervariabele": "...", "invoervariabelen": "...", "parameters": "...",
      "voorwaarden": "...", "formulering": "<gestructureerde pseudo>",
      "vindplaats": "art. 2 lid 1", "twijfel": "..."
    }
  ],
  "validatiepunten": ["<aandachtspunt 1>", "<aandachtspunt 2>"]
}
```

Gebruik **stabiele id's** (`m1`, `m2`, … / `b1`, `r1`, …). De feedback koppelt daarop terug.

## De server starten

Ronde 1 (geen vorige context):

```bash
python "<skill>/scripts/review_server.py" \
  --input "<werkmap>/activiteit-2/ronde-1/analyse.json" \
  --activiteit 2 \
  --feedback-out "<werkmap>/activiteit-2/ronde-1/feedback.json" \
  --ronde 1
```

Ronde 2 en verder: geef met `--vorige` de map van de vorige ronde mee. De server laadt
dan `analyse.json` en `feedback.json` van die ronde en toont per item wat de analist toen
vroeg en hoe het item er toen uitzag, zodat zichtbaar is of de correctie geland is:

```bash
python "<skill>/scripts/review_server.py" \
  --input "<werkmap>/activiteit-2/ronde-2/analyse.json" \
  --activiteit 2 \
  --feedback-out "<werkmap>/activiteit-2/ronde-2/feedback.json" \
  --ronde 2 \
  --vorige "<werkmap>/activiteit-2/ronde-1"
```

Default poort 3118. Start de server in de achtergrond, geef de analist de URL
(`http://localhost:3118`), en **pauzeer**: rond je beurt af met een duidelijke instructie
("Bekijk de review, geef feedback of klik Akkoord, en laat het me weten als je klaar bent").
Ga niet zelf door tot de analist bevestigt.

## Schema — `feedback.json` (door de viewer geschreven, per ronde)

```json
{
  "status": "akkoord",            // of "wijzigingen"
  "activiteit": "2",
  "items": { "m2": "Plichthebbende benoemen.", "b1": "Definitie te ruim." },
  "algemeen": "Markering voor 'partner' ontbreekt."
}
```

Gebruik **stabiele id's** (`m1`, `m2`, … / `b1`, `r1`, …) en **houd ze stabiel tussen
rondes**: hetzelfde concept houdt hetzelfde id, ook na een correctie. Daarop koppelt de
feedback terug én daarop matcht de viewer de vorige versie van een item.

## De iteratieve lus

De review herhaalt zich tot de analist akkoord is zonder verdere opmerkingen:

1. **Schrijf** `ronde-{N}/analyse.json` en start de server (ronde 1 zonder `--vorige`,
   ronde 2+ met `--vorige ronde-{N-1}` en `--ronde N`).
2. **Pauzeer** en wacht tot de analist bevestigt dat die klaar is.
3. **Lees** `ronde-{N}/feedback.json`.
   - Bij `status: "akkoord"` **zonder** `items` en **zonder** `algemeen`: de lus is klaar.
     Stop de server en ga door (naar activiteit 3, of naar het rapport).
   - Anders: verwerk **elk** gevuld veld. Per `id` pas je de betreffende markering /
     begrip / regel aan (herclassificeren, toelichting/definitie bijstellen). De
     `algemeen`-tekst kan leiden tot toegevoegde of verwijderde items, of methodische
     aanpassingen. Stop de server, verhoog `N`, en ga terug naar stap 1 met het herziene
     resultaat.
4. **Veiligheidscap:** stop na maximaal **6 rondes**, ook als er nog feedback is. Meld dit
   aan de analist en noteer het in de reviewlog (de resterende punten horen dan bij de
   aandachtspunten voor validatie).

Houd per ronde bij wat je hebt gewijzigd; het aantal rondes en de wijzigingen komen in de
**Reviewlog** van het eindrapport.

## Niet-interactief draaien (alleen voor evals/automatisering)

Bij `WETSANALYSE_NO_REVIEW=1` in de omgeving sla je de hele lus over: schrijf één keer
`ronde-1/analyse.json` (geen server, geen pauze) en noteer in het eindrapport dat de
reviews zijn overgeslagen. Gebruik dit uitsluitend voor geautomatiseerde tests; voor
mensen blijven de checkpoints altijd aan.
