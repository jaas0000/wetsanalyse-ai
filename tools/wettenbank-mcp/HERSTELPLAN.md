# Herstelplan wettenbank-MCP

Opgesteld n.a.v. een kritisch review op de werking (live smoke-tests + code-/robuustheidsreview).
Doel: de bevestigde defecten oplossen, met **brongetrouwheid** als hoogste prioriteit — geen
stil tekstverlies, geen stille duplicatie, geen herordening. Elke fix krijgt een regressietest.

Uitgangspunt: alle wijzigingen in `src/`, daarna `npm run build` (commit `dist/`) en `npm test`.
Werk op een aparte branch (`fix/brongetrouwheid`), één fase = één logische commit.

---

## Bevindingen, gesorteerd op prioriteit

Legenda ernst: 🔴 kritiek (brongetrouwheid kapot) · 🟠 hoog · 🟡 middel · ⚪ laag.

| # | Ernst | Korte omschrijving | Kern-locatie | Status |
|---|-------|--------------------|--------------|--------|
| 1 | 🔴 | Tekstverlies bij geneste `circulaire.divisie` (≥3 niveaus) | `normalizer.ts:103-156` | bevestigd (agent) |
| 2 | 🔴 | Tabel zonder `<thead>` dupliceert eerste rij | `mcp-lite.ts:248-261` | **zelf geverifieerd** |
| 3 | 🔴 | Sub-divisietitels verdwijnen uit het `pad` | `normalizer.ts:149-155` + `mcp-lite.ts:127-134` | bevestigd (agent) |
| 4 | 🟠 | Markdown-tabel: geen pipe-escaping + colspan/rowspan genegeerd | `mcp-lite.ts:240-265` | **pipe zelf geverifieerd** |
| 5 | 🟠 | **Blokvolgorde binnen een lid niet behouden** (tekst→tabel→tekst) | `normalizer.ts:191-206` + `mcp-lite.ts:109-123` | **zelf geverifieerd (code)** |
| 6 | 🟠 | `parseZoekterm`: lowercase `en`/`of` → 0 treffers; interne `*` gestript; dupliceert `bouwTermPatroon` | `zoekterm-engine.ts:40-54` | **zelf geverifieerd (live)** |
| 7 | 🟠 | HTTP-sessielek: geen idle-cleanup van verlaten transports | `http-server.ts:79,114-122` | bevestigd (agent) |
| 8 | 🟠 | Malformed XML → stil lege resultaten i.p.v. expliciete fout | `sru-client.ts:75-101`, `repository-client.ts:95` | bevestigd (agent) |
| 9 | 🟡 | Meerdere `<al>` per tabelcel zonder scheiding aaneengeplakt | `parser.ts:274-283` + `mcp-lite.ts:177-180` | bevestigd (agent) |
| 10 | 🟡 | Cache zonder max-grootte (LRU); volledige XML+DOM per entry | `repository-client.ts:26-31,67` | bevestigd (agent) |
| 11 | 🟡 | `peildatum`-regex valideert vorm, niet geldigheid (`2024-13-45`) | `schemas.ts:29,39,48,53` | bevestigd (agent) |
| 12 | 🟡 | Bearer-auth: `!==` i.p.v. `timingSafeEqual`; open deur als token ontbreekt | `http-server.ts:97` | bevestigd (agent) |
| 13 | ⚪ | `parseRecords` prefix-afhankelijk (`dcterms:` i.p.v. NS-URI); CQL-titel ongeescaped; `AbortError`-message cryptisch | `sru-client.ts:61-101`, `zoek.ts:16` | bevestigd (agent) |

---

## Fasering

### Fase A — Brongetrouwheid (🔴 + de structurele 🟠's): #1, #2, #3, #4, #5, #9

Dit is het hart van het project en wordt als eerste opgepakt. #1, #3 en #5 raken dezelfde
normalizer-tak en lossen deels samen op; daarom in één fase.

#### A0 — Voorbereiding: ophalen van echte testfixtures
Voordat we iets wijzigen, leg representatieve XML-fragmenten vast als testfixtures:
- een Leidraad-`circulaire.divisie` met ≥3 nestingsniveaus (issue #1, #3);
- een artikel-lid met `<al>…</al><tabel>…</tabel><al>…</al>` (issue #5);
- een tabel zónder `<thead>` (issue #2);
- een tabel met `colspan`/`rowspan` en met `|`-tekens in cellen (issue #4);
- een tabelcel met meerdere `<al>` (issue #9).

Bron: `repository.officiele-overheidspublicaties.nl` (zie `repositoryUrl` uit `wettenbank_zoek`).
Bewaar als kleine, geknipte fixtures onder `src/bwb-parser/__fixtures__/`. **Eerst falende tests
schrijven** die de huidige fout aantonen, daarna fixen (rood → groen).

#### A1 — Issue #5: blokvolgorde binnen een lid behouden (root-cause fix, eerst)
**Oorzaak:** `buildLid` splitst kinderen in `content` (alle `<al>` samengevoegd) en `children`
(lijsten/tabellen), en `createMcpLiteNode` rendert eerst alle tekst, dan alle children. Het
interleaven gaat verloren.

**Aanpak (minimaal invasief, behoudt `tekst` voor zoek/compat):**
1. In `types.ts` `NormalizedLid` uitbreiden met een geordend blokveld:
   `blocks: NormalizedNode[]` — de `<al>`, `<lijst>` en `<table>` in **documentvolgorde**
   (elke `<al>` als `NormalizedLeaf`). `tekst` en `content` blijven bestaan (platte concatenatie,
   nog gebruikt voor leesbaarheid/compat).
2. In `normalizer.ts` `buildLid` (en de divisie-tak) een geordende lijst opbouwen i.p.v. de
   al/niet-al-splitsing: loop één keer over de oorspronkelijke kinderen en push per kind het
   genormaliseerde blok. `content`/`tekst` blijven de concatenatie van de `al`-blokken (voor
   compat), maar worden afgeleid uit `blocks`.
3. In `mcp-lite.ts` `createMcpLiteNode`: als `blocks` aanwezig is, render **uitsluitend** uit
   `blocks` in volgorde (en niet meer "content eerst, children erna"). Val terug op het oude
   pad voor node-typen zonder `blocks`.

**Test:** fixture tekst→tabel→tekst → output heeft de tabel tússen de twee tekstblokken, en de
twee tekstblokken zijn niet aaneengeplakt.

#### A2 — Issue #1 + #3: recursieve `circulaire.divisie`-normalisatie
**Oorzaak:** sub-divisies worden als platte "leden" van één niveau diep afgehandeld (`buildLid`
neemt alleen directe `al` mee, niet de sub-sub-divisies), en hun `kop` (label/titel) gaat verloren.

**Aanpak:** behandel `circulaire.divisie` als een **echte container met geneste divisie-children**,
net als reguliere structuur — niet als een platte ledenlijst. Concreet:
- maak de divisie-tak in `normalizeArtikel` recursief: een divisie krijgt zijn eigen content-lid
  én zijn sub-divisies als genормaliseerde child-divisies (die zélf weer recursief gaan);
- behoud `nr` + `label` + `titel` van elke (sub)divisie in de metadata, zodat het pad in
  `mcp-lite.ts` `"Paragraaf 1.1.1 …"` wordt i.p.v. `"> Lid 1.1.1"`;
- pas de pad-opbouw in `createMcpLiteNode` (`mcp-lite.ts:125-134`) aan zodat divisie-niveaus
  als pad-segmenten verschijnen.

**Test:** 3-niveau Leidraad-fixture → tekst van niveau 1.1.1 komt voor in de output; het pad
bevat alle drie de niveaus met hun titels. Verifieer ná de fix ook live tegen de
Leidraad Invordering 2008 via `wettenbank_structuur` + `wettenbank_artikel`.

> Let op de invariant in `types.ts:10`: *"de NORMALIZED-laag mag nooit informatie verliezen t.o.v.
> RAW."* #1 en #3 schenden die nu; deze fix herstelt hem. Overweeg een assertion/test die dat bewaakt.

#### A3 — Issue #2: tabel zonder `<thead>` niet dupliceren
**Oorzaak:** `renderTableToMarkdown` emit bij lege head de eerste rij als header (regel 252) én
neemt daarna `dataRows = allRows` (regel 258), dus dezelfde rij opnieuw.

**Aanpak:** twee opties — kies de bovenste:
- **(voorkeur)** bij ontbrekende `<thead>` géén header fabriceren maar een lege/placeholder-header
  + separator emitten, en alle body-rijen als data; óf
- als wél de eerste rij als header dient, dan `dataRows` consequent `allRows.slice(1)` maken
  ongeacht of er een head was.

**Test:** `tbody` met rijen r1/r2 (geen thead) → r1 komt exact één keer voor.

#### A4 — Issue #4: pipe-escaping + colspan/rowspan in Markdown-tabellen
**Aanpak in `renderTableToMarkdown`:**
- escape celtekst vóór plaatsing tussen `|`: `|` → `\|`, en `\n` → `<br>` (of spatie);
- expandeer `colspan` naar lege cellen (of herhaal de waarde) zodat elke rij het juiste aantal
  kolommen (`group.cols`) heeft; doe hetzelfde principe voor `rowspan` (lege opvulcellen in de
  volgende rij(en)). `normalizeEntry` levert `rowspan`/`colspan` al aan — alleen de renderer
  negeert ze nu.

**Test:** cel met `colspan=2` onder 3-koloms header → rij heeft 3 kolommen; cel met `a | b` →
blijft één kolom (`a \| b`).

#### A5 — Issue #9: meerdere `<al>` per tabelcel scheiden
**Aanpak:** in `mcp-lite.ts` `renderContent` (al-tak, regel 175-181) of in `parseContentNodes`
een scheiding (`<br>` of spatie) toevoegen tussen opeenvolgende `al`-items binnen één cel.

**Test:** `<entry><al>regel een</al><al>regel twee</al></entry>` → `regel een<br>regel twee`
(of met spatie), niet `regel eenregel twee`.

---

### Fase B — Zoekfunctie correct: #6

#### B1 — `parseZoekterm` herschrijven om `bouwTermPatroon` te hergebruiken
**Oorzaak:** `parseZoekterm` heeft een eigen `regexify` (strip álle `*`, case-sensitive operatoren),
waardoor (a) lowercase `en`/`of` → 0 treffers, (b) interne `*` stil verdwijnt, (c) de geteste
`bouwTermPatroon` in productie ongebruikt is.

**Aanpak:**
- detecteer operatoren **case-insensitive** met woordgrenzen (`\bEN\b`/`\bOF\b`/`\bAND\b`/`\bOR\b`),
  zodat "ENERGIE" niet als operator telt;
- splits per deelterm en roep per deel **`bouwTermPatroon`** aan (één bron van waarheid);
- valideer/normaliseer deeltermen: weiger lege termen en bare `*` (geef desnoods `{fout: …}`).

**Test:** `uitstel en betaling` (lowercase) geeft dezelfde treffers als `uitstel EN betaling`
(live nu: 5 artikelen / 179 treffers vs 0); `ter*mijn` gedraagt zich gedefinieerd; lege term
en bare `*` worden afgevangen. Live regressie via `wettenbank_zoekterm`.

---

### Fase C — Robuustheid & deployment: #7, #8, #10, #11, #12, #13

#### C1 — Issue #8: malformed XML expliciet afvangen
xmldom gooit bij ongeldige XML geen exception maar geeft een (leeg) document. Controleer in
`parseRecords`/`haalWetstekstOp` of `doc.documentElement` bestaat en of er parse-errors waren
(xmldom `onError`/locator-hook). Geef `{fout: "ongeldige XML van bron"}` i.p.v. stil `[]`/"geen
regeling gevonden". **Test:** voer kapotte XML in → expliciete fout.

#### C2 — Issue #7: HTTP-sessies opruimen
Voeg `last-seen`/idle-timeout toe per sessie en ruim verlaten transports periodiek op (bijv. een
`setInterval(...).unref()` zoals bij de cache). Overweeg een hard cap op gelijktijdige sessies.
**Test:** simuleer een sessie zonder `onclose` → wordt na de idle-timeout verwijderd.

#### C3 — Issue #10: cache-LRU-cap
Voeg naast de TTL een max aantal entries toe (LRU-evictie). Elke entry bevat de volledige rauwe
XML + geparsed Document, dus de cap voorkomt onbegrensde groei binnen één uur. **Test:** voeg
N+1 entries toe → oudste wordt geëvict.

#### C4 — Issue #11: peildatum-geldigheid valideren
Voeg in `schemas.ts` een `.refine` toe die de datum echt valideert (`new Date` / kalendercheck),
zodat `2024-13-45` wordt geweigerd i.p.v. een misleidende "geen regeling gevonden". **Test:**
ongeldige-maar-welgevormde datum → validatiefout.

#### C5 — Issue #12: auth hardening
Gebruik `crypto.timingSafeEqual` voor de bearer-vergelijking. Overweeg **fail-closed** in
HTTP-modus: weiger te starten als `MCP_AUTH_TOKEN` niet is gezet (i.p.v. stil open). **Test:**
ontbrekende token → start faalt (of expliciete waarschuwing volgens gekozen beleid).

#### C6 — Issue #13: kleine robuustheidsverbeteringen (optioneel/laag)
- `parseRecords`: overweeg `getElementsByTagNameNS(uri, localName)` i.p.v. prefix-match;
- `zoek.ts`: escape/strip dubbele quotes in de CQL-titelwaarde;
- vang `AbortError` en hergooi als `"SRU-timeout na 15s"`.

---

## Testdekking-acties (overkoepelend)

De huidige suite (87 tests) dekt happy-paths breed maar miste alle bovenstaande defecten. Voeg toe:
- regressietests voor #1–#5 en #9 op basis van de fixtures uit A0;
- malformed-XML-test (#8);
- end-to-end tests op de tool-handlers (`handleArtikel`/`handleStructuur`/`handleZoekterm`) met
  realistische XML, inclusief de `pad`/`sectie`-afleiding;
- vervang zwakke asserts zoals `toBeGreaterThanOrEqual(1)` (`mcp-lite.test.ts:36`) door exacte
  node-aantallen waar dat regressies vangt;
- zorg dat de zoekterm-tests het **werkelijke** pad (`parseZoekterm`) dekken, niet alleen
  `bouwTermPatroon`.

## Definition of done (per fix)
1. Falende test geschreven die de fout aantoont (rood).
2. Fix in `src/`; `npm run build`; `npm test` groen (incl. nieuwe test).
3. Waar relevant: live geverifieerd via de MCP-tools tegen de echte API.
4. `dist/` mee-gecommit (wordt gedraaid en is in de repo gecommit).

## Aanbevolen volgorde
Fase A (A0 → A1 → A2 → A3 → A4 → A5) → Fase B → Fase C. A1 en A2 raken dezelfde normalizer-tak;
doe A1 eerst (geordende blokken) zodat A2 daarop kan voortbouwen.
