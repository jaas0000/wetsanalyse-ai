# Review-checkpoints — datacontract en werkwijze

Na activiteit 2 en na activiteit 3 pauzeert de skill voor een review door de analist
(human-in-the-loop). Dit bestand beschrijft hoe je het tussenresultaat wegschrijft, de
review-server start, en de feedback verwerkt.

Waarom: Wetsanalyse is een multidisciplinaire, iteratieve methode. De betekenis van
wetgeving — en zeker de interpretatiekeuzes — moeten door mensen (jurist,
informatieanalist, ICT) worden gevalideerd vóórdat de analyse de uitvoering in gaat. De
review-momenten maken die validatie expliciet en traceerbaar.

## Werkmap

Schrijf tussenresultaten en feedback naar een werkmap naast (of bij) het eindrapport,
bijvoorbeeld `werk/` in de outputmap. Vaste bestandsnamen:

- `werk/activiteit-2.json` — tussenresultaat activiteit 2 (jij schrijft dit)
- `werk/feedback-activiteit-2.json` — feedback van de analist (de viewer schrijft dit)
- `werk/activiteit-3.json` — tussenresultaat activiteit 3
- `werk/feedback-activiteit-3.json` — feedback activiteit 3

## Schema — `activiteit-2.json`

```json
{
  "wet": "Wet op de zorgtoeslag",
  "bwbId": "BWBR0018451",
  "artikel": "2",
  "versiedatum": "2026-01-01",
  "bronreferentie": "jci1.3:c:BWBR0018451&artikel=2",
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

## Schema — `activiteit-3.json`

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
  "validatiepunten": "<concept-aandachtspunten voor validatie>"
}
```

Gebruik **stabiele id's** (`m1`, `m2`, … / `b1`, `r1`, …). De feedback koppelt daarop terug.

## De server starten

```bash
python "<skill>/scripts/review_server.py" \
  --input "<werkmap>/activiteit-2.json" \
  --activiteit 2 \
  --feedback-out "<werkmap>/feedback-activiteit-2.json"
```

Default poort 3118. Start de server in de achtergrond, geef de analist de URL
(`http://localhost:3118`), en **pauzeer**: rond je beurt af met een duidelijke instructie
("Bekijk de review, geef feedback of klik Akkoord, en laat het me weten als je klaar bent").
Ga niet zelf door tot de analist bevestigt.

## Schema — `feedback-activiteit-N.json` (door de viewer geschreven)

```json
{
  "status": "akkoord",            // of "wijzigingen"
  "activiteit": "2",
  "items": { "m2": "Plichthebbende benoemen.", "b1": "Definitie te ruim." },
  "algemeen": "Markering voor 'partner' ontbreekt."
}
```

## Feedback verwerken

1. Lees het feedbackbestand zodra de analist bevestigt dat die klaar is.
2. Bij `status: "akkoord"` zonder `items` en zonder `algemeen`: ga ongewijzigd verder.
3. Anders: verwerk **elk** gevuld veld. Per `id` pas je de betreffende markering / begrip /
   regel aan (herclassificeren, toelichting/definitie bijstellen). De `algemeen`-tekst kan
   leiden tot toegevoegde of verwijderde items, of methodische aanpassingen.
4. Stop de server (Ctrl+C / kill) zodra de feedback verwerkt is.
5. Houd bij wat je hebt gewijzigd; dit komt in de **Reviewlog** van het eindrapport.

## Niet-interactief draaien (alleen voor evals/automatisering)

Bij `WETSANALYSE_NO_REVIEW=1` in de omgeving sla je de review-stops over (geen server, geen
pauze) en noteer je in het eindrapport dat de reviews zijn overgeslagen. Gebruik dit
uitsluitend voor geautomatiseerde tests; voor mensen blijven de checkpoints altijd aan.
