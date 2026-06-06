# Wettenbank MCP — Documentatie

**Versie:** 3.0.0
**Taal:** TypeScript (ESM)
**Transportprotocol:** StdIO (MCP)
**Databron:** wetten.overheid.nl — publieke SRU-interface (CC-0, geen API-sleutel vereist)

---

## Inhoud

1. [Doel en werking](#1-doel-en-werking)
2. [Architectuur](#2-architectuur)
3. [Tools](#3-tools)
4. [Gegevensmodel](#4-gegevensmodel)
5. [Modules en functies](#5-modules-en-functies)
6. [XML-schemas als ontwerpbasis](#6-xml-schemas-als-ontwerpbasis)
7. [Foutafhandeling](#7-foutafhandeling)
8. [Installatie en configuratie](#8-installatie-en-configuratie)
9. [Ontwikkeling en testen](#9-ontwikkeling-en-testen)

---

## 1  Doel en werking

De Wettenbank MCP-server maakt het mogelijk om **vanuit Claude Code rechtstreeks actuele Nederlandse wetgeving op te vragen** via de publieke SRU-interface van wetten.overheid.nl. Er is geen API-sleutel vereist: alle data is onder CC-0 openbaar beschikbaar.

**Vier tools zijn beschikbaar:**

| Tool                     | Doel |
|--------------------------|------|
| `wettenbank_zoek`        | Regelingen zoeken op titel, rechtsgebied, ministerie of regelingsoort; retourneert **JSON** met `regelingen`-array |
| `wettenbank_structuur`   | Inhoudsopgave van een wet ophalen: hiërarchie van hoofdstukken, afdelingen, paragrafen en artikelnummers — zonder artikeltekst te laden |
| `wettenbank_artikel`     | Één artikel ophalen via BWB-id + artikelnummer; retourneert **JSON** met `leden`, `pad`, `bronreferentie` en `formaat` |
| `wettenbank_zoekterm`    | Zoeken welke artikelen een begrip bevatten; wildcards en EN/OF-operatoren; optioneel direct artikeltekst meesturen |

**Aanbevolen workflow voor een LLM:**

```
wettenbank_zoek        → BWB-id achterhalen
wettenbank_structuur   → inhoudsopgave laden, juist artikelnummer bepalen
wettenbank_artikel     → specifiek artikel ophalen
```

Of in één stap voor full-text zoeken:

```
wettenbank_zoekterm (includeerTekst=true) → zoeken + tekst in één call
```

---

## 2  Architectuur

### Bestandsstructuur

```
src/
├── index.ts                    # Entry point — startup + re-exports (48r)
├── server.ts                   # MCP Server — tool-definities en handlers (194r)
│
├── clients/
│   ├── sru-client.ts           # SRU HTTP-client + XML-parsing (101r)
│   └── repository-client.ts    # BWB repo fetch + in-memory cache (122r)
│
├── search/
│   └── zoekterm-engine.ts      # Wildcard-regex + EN/OF-zoeklogica (136r)
│
├── tools/
│   ├── zoek.ts                 # wettenbank_zoek handler (30r)
│   ├── structuur.ts            # wettenbank_structuur handler (116r)
│   ├── artikel.ts              # wettenbank_artikel handler (78r)
│   └── zoekterm.ts             # wettenbank_zoekterm handler (68r)
│
├── shared/
│   └── schemas.ts              # Zod input/output schemas — source of truth (149r)
│
└── bwb-parser/
    ├── index.ts                # Publieke API + parseBwb() pipeline (70r)
    ├── types.ts                # TypeScript type-definities RAW/NORMALIZED/MCP-LITE (199r)
    ├── parser.ts               # XML DOM → RAW BwbNode-boom (392r)
    ├── normalizer.ts           # RAW → NORMALIZED structuur (344r)
    └── mcp-lite.ts             # NORMALIZED → token-efficiënte Markdown-JSON (262r)
```

### Communicatiemodel

```
Claude Code (LLM)
      │  tool call (JSON over stdin)
      ▼
  server.ts — MCP-protocol + dispatcher
      │
      ├── tools/zoek.ts ────────► sru-client.ts → SRU-zoekdienst
      │
      ├── tools/structuur.ts ───► repository-client.ts → BWB XML
      │                               └─► bwb-parser: parse → normalize
      │                                       └─► structuurboom extraheren
      │
      ├── tools/artikel.ts ─────► repository-client.ts → BWB XML
      │                               └─► bwb-parser: parse → normalize → mcp-lite
      │
      └── tools/zoekterm.ts ────► repository-client.ts → BWB XML
                                      ├─► zoekterm-engine: EN/OF-zoeken
                                      └─► (optioneel) bwb-parser per gevonden artikel

      ▲  tool result (JSON over stdout)
      │
Claude Code (LLM)
```

### BWB-parser pipeline

De `bwb-parser`-module volgt een drielaagse transformatie:

```
BWB-toestand XML
      ↓
  parser.ts → BwbNode (RAW)
      ↓
  normalizer.ts → NormalizedNode
      ↓
  mcp-lite.ts → McpLiteNode[]  (token-efficiënt, Markdown-tekst)
```

Elke laag is puur en testbaar in isolatie. Informatie gaat nooit verloren tussen lagen.

### Externe endpoints

| Endpoint | Gebruik |
|----------|---------|
| `https://zoekservice.overheid.nl/sru/Search` | SRU 2.0-zoekdienst — alle vier tools |
| `https://repository.officiele-overheidspublicaties.nl/bwb/<id>/` | BWB-toestand XML — structuur, artikel, zoekterm |

### In-memory cache

`repository-client.ts` beheert een `xmlCache: Map<string, CacheEntry>` met TTL van 1 uur. Sleutel: `"bwbId|peildatum"`. Voorkomt herhaalde netwerkverzoeken voor dezelfde wet op dezelfde datum.

---

## 3  Tools

### 3.1  `wettenbank_zoek`

Zoekt in het Basiswettenbestand op naam en/of filtert op type, rechtsgebied of ministerie.

**Parameters:**

| Parameter       | Type   | Verplicht | Omschrijving |
|-----------------|--------|:---------:|--------------|
| `titel`         | string |           | Zoekterm in de regelingtitel, bijv. `"Invorderingswet"` |
| `rechtsgebied`  | string |           | Bijv. `"belastingrecht"`, `"arbeidsrecht"` |
| `ministerie`    | string |           | Bijv. `"Financiën"`, `"Justitie"` |
| `regelingsoort` | enum   |           | `wet` · `AMvB` · `ministeriele-regeling` · `regeling` · `besluit` |
| `maxResultaten` | number |           | Maximum aantal resultaten (standaard: 10, maximum: 50) |
| `peildatum`     | string |           | Versie geldig op datum `YYYY-MM-DD` (standaard: vandaag) |

Minimaal één zoekcriterium is vereist (Zod `.refine()`).

**Resultaatformaat (JSON):**

```json
{
  "formaat": "plain",
  "totaal": 2,
  "regelingen": [
    {
      "bwbId": "BWBR0004770",
      "titel": "Invorderingswet 1990",
      "type": "wet",
      "ministerie": "Ministerie van Financiën",
      "rechtsgebied": "Belastingrecht",
      "geldigVanaf": "1990-06-30",
      "geldigTot": "onbepaald",
      "gewijzigd": "2024-01-01",
      "repositoryUrl": "https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0004770/..."
    }
  ]
}
```

---

### 3.2  `wettenbank_structuur`

Haalt de inhoudsopgave van een wet op. Retourneert alleen structuurmetadata (nummers, titels, artikellijsten) — geen artikeltekst. Gebruik dit om gericht te navigeren vóór `wettenbank_artikel`.

**Parameters:**

| Parameter   | Type   | Verplicht | Omschrijving |
|-------------|--------|:---------:|--------------|
| `bwbId`     | string | **ja**    | BWB-id, bijv. `BWBR0004770` |
| `peildatum` | string |           | Datum `YYYY-MM-DD` (standaard: vandaag) |

**Resultaatformaat (JSON):**

```json
{
  "formaat": "plain",
  "bwbId": "BWBR0004770",
  "citeertitel": "Invorderingswet 1990",
  "versiedatum": "2024-01-01",
  "structuur": [
    {
      "type": "hoofdstuk",
      "nr": "I",
      "titel": "Inleidende bepalingen",
      "artikelen": ["1", "2", "3"]
    },
    {
      "type": "hoofdstuk",
      "nr": "II",
      "titel": "Invordering in eerste aanleg",
      "secties": [
        {
          "type": "afdeling",
          "nr": "1",
          "titel": "Betalingstermijnen",
          "artikelen": ["9", "10", "11"]
        }
      ]
    }
  ]
}
```

Wetten zonder hoofdstukstructuur retourneren een platte artikellijst:

```json
{
  "structuur": [{ "type": "wet", "nr": "", "artikelen": ["1", "2", "3", ...] }]
}
```

---

### 3.3  `wettenbank_artikel`

Haalt één artikel op via BWB-id en artikelnummer. De response bevat alle leden in Markdown-tekst.

**Parameters:**

| Parameter   | Type   | Verplicht | Omschrijving |
|-------------|--------|:---------:|--------------|
| `bwbId`     | string | **ja**    | BWB-id, bijv. `BWBR0004770` |
| `artikel`   | string | **ja**    | Artikelnummer, bijv. `"9"`, `"3:40"` (Awb) of `"25.1"` (Leidraad) |
| `lid`       | string |           | Lidnummer — geeft alleen dat lid terug |
| `peildatum` | string |           | Historische versie op datum `YYYY-MM-DD` (standaard: vandaag) |

**Resultaatformaat (JSON):**

```json
{
  "formaat": "plain",
  "citeertitel": "Invorderingswet 1990",
  "versiedatum": "2024-01-01",
  "bwbId": "BWBR0004770",
  "artikel": "9",
  "sectie": "Artikel 9",
  "pad": "Hoofdstuk II > Afdeling 1 > Artikel 9",
  "leden": [
    {
      "lid": "1",
      "tekst": "Een belastingaanslag is invorderbaar zes weken na de dagtekening van het aanslagbiljet."
    },
    {
      "lid": "2",
      "tekst": "In afwijking van het eerste lid is een navorderingsaanslag..."
    }
  ],
  "bronreferentie": "jci1.3:c:BWBR0004770&artikel=9"
}
```

**`formaat`-veld:** `"markdown"` als de tekst Markdown-syntax bevat (tabellen `|...|`, genummerde lijsten `1.`, letterlijsten `a.`, streepjes `–`); anders `"plain"`. Stelt een LLM in staat de tekst correct te renderen.

**`pad`-veld:** Volledig hiërarchisch pad als compacte string. Alleen aanwezig als het artikel structuurancestors heeft.

**`leden`-array:** Één entry per genummerd lid. Bij artikelen zonder genummerde leden (bijv. Leidraad `circulaire.divisie`) één entry met `lid: ""`.

Artikel niet gevonden: `{ "fout": "Artikel 999 niet gevonden." }`

---

### 3.4  `wettenbank_zoekterm`

Zoekt welke artikelen een begrip bevatten. Ondersteunt wildcards en booleaanse operatoren.

**Parameters:**

| Parameter       | Type    | Verplicht | Omschrijving |
|-----------------|---------|:---------:|--------------|
| `bwbId`         | string  | **ja**    | BWB-id, bijv. `BWBR0004770` |
| `zoekterm`      | string  | **ja**    | Zie wildcards/operatoren hieronder |
| `peildatum`     | string  |           | Datum `YYYY-MM-DD` (standaard: vandaag) |
| `maxResultaten` | number  |           | Maximum artikelen in uitvoer (standaard: 10, maximum: 50) |
| `includeerTekst`| boolean |           | `true` = artikeltekst direct meesturen (standaard: `false`) |

**Wildcards en operatoren:**

| Invoer | Regex | Matcht |
|--------|-------|--------|
| `termijn` | `\btermijn\b` | exacte woordmatch |
| `termijn*` | `\btermijn\w*` | `termijn`, `termijnen`, `termijnoverschrijding` |
| `*termijn` | `\w*termijn\b` | `termijn`, `betalingstermijn` |
| `*termijn*` | `\w*termijn\w*` | alles met `termijn` erin |
| `aansprakelijk EN belasting` | twee patronen, AND | alleen artikelen met beide termen |
| `uitstel OF afstel` | twee patronen, OR | artikelen met minstens één term |

`AND` en `OR` worden herkend als aliassen voor `EN` en `OF`.

**Resultaatformaat (JSON, zonder tekst):**

```json
{
  "formaat": "plain",
  "wet": "Invorderingswet 1990",
  "versiedatum": "2024-01-01",
  "bwbId": "BWBR0004770",
  "zoekterm": "dwangbevel",
  "totaalTreffers": 12,
  "isVolledig": true,
  "aantalArtikelen": 4,
  "artikelen": [
    { "artikel": "13", "aantalTreffers": 5, "leden": ["1", "3"] },
    { "artikel": "14", "aantalTreffers": 3, "leden": [] }
  ]
}
```

**Met `includeerTekst: true`** bevat elk artikel-object ook:

```json
{
  "artikel": "13",
  "aantalTreffers": 5,
  "leden": ["1", "3"],
  "tekst": "**Lid 1** Een dwangbevel...\n\n**Lid 3** ...",
  "formaat": "markdown"
}
```

`totaalTreffers` is de som over *alle* gevonden artikelen, ook als `maxResultaten` de uitvoer afkapt.

---

## 4  Gegevensmodel

### `Regeling` (SRU-record)

| Veld | Type | Bron (BWB-WTI XSD) |
|------|------|--------------------|
| `bwbId` | string | `owmskern/dcterms:identifier` |
| `titel` | string | `owmskern/dcterms:title` |
| `type` | string | `owmskern/dcterms:type` |
| `ministerie` | string | `owmskern/overheid:authority` |
| `rechtsgebied` | string | `bwbipm/overheidbwb:rechtsgebied` (kommalijst bij meerdere) |
| `geldigVanaf` | string | `bwbipm/overheidbwb:geldigheidsperiode_startdatum` |
| `geldigTot` | string | `bwbipm/overheidbwb:geldigheidsperiode_einddatum` of `"onbepaald"` |
| `gewijzigd` | string | `owmskern/dcterms:modified` |
| `repositoryUrl` | string | `enrichedData/overheidbwb:locatie_toestand` |

### BWB-parser node-types

| Laag | Type | Omschrijving |
|------|------|--------------|
| RAW | `BwbNode` | Directe DOM-representatie; `content: ContentItem[] \| null` voor mixed content |
| NORMALIZED | `NormalizedContainer` | Structurele container (hoofdstuk, afdeling, paragraaf) |
| NORMALIZED | `NormalizedArtikel` | Artikel of circulaire.divisie met `leden: NormalizedLid[]` |
| NORMALIZED | `NormalizedLid` | Lid met `lidnr`, `tekst`, `content`, `children` |
| NORMALIZED | `NormalizedLijst` | Gestructureerde lijst met `items: NormalizedListItem[]` |
| NORMALIZED | `NormalizedTable` | CALS-tabel met uitgewerkte rowspan/colspan |
| MCP-LITE | `McpLiteNode` | `{ bwbId, citeertitel, sectie, tekst, bronreferentie }` |

### `StructuurNode` (recursief)

```typescript
{
  type: string;              // "hoofdstuk", "afdeling", "paragraaf", "subparagraaf", ...
  nr: string;
  titel?: string;
  artikelen?: string[];      // aanwezig op leaf-level (geen sub-secties)
  secties?: StructuurNode[]; // aanwezig als er sub-containers zijn
}
```

---

## 5  Modules en functies

### `src/clients/sru-client.ts`

| Functie/export | Doel |
|----------------|------|
| `sruRequest(query, maxRecords?)` | HTTP GET naar SRU-zoekdienst; geeft raw XML terug |
| `parseRecords(xml)` | Parsed SRU-XML naar `Regeling[]` |
| `dedupliceerOpBwbId(lijst)` | Behoudt per BWB-id de meest recente versie (op `geldigVanaf`) |
| `getElText(parent, tagName)` | Extraheert tekstinhoud van eerste child met gegeven tagnaam |
| `getAttr(el, attrName)` | Leest attribuutwaarde van een element |
| `stripXml(xml)` | Verwijdert XML-tags, comprimeert witruimte |
| `domParser` | `DOMParser`-instantie (gedeeld) |
| `REPO_BASE` | Basis-URL van de BWB-repository |

### `src/clients/repository-client.ts`

| Functie/export | Doel |
|----------------|------|
| `haalWetstekstOp(bwbId, peildatum?)` | SRU-lookup + repository-download; beheert `xmlCache`; geeft `{ rawXml, doc, regeling }` terug |
| `extraheerDocMetadata(doc)` | Haalt `citeertitel` + `versiedatum` uit BWB-toestand DOM |
| `zoekElementInDom(el, artikelnummer)` | Recursieve DOM-traversal: zoekt `<artikel>` of `<circulaire.divisie>` op nummer |
| `extractTextForSearch(el)` | Extraheert plain-text uit een DOM-element voor zoekdoeleinden (slaat `<kop>` over) |
| `xmlCache` | `Map<string, CacheEntry>` — exporteerbaar voor tests en cache-clearing |

### `src/search/zoekterm-engine.ts`

| Functie/export | Doel |
|----------------|------|
| `parseZoekterm(zoekterm)` | Normaliseert AND/OR → EN/OF; splitst; geeft `{ patronen: RegExp[], operator }` |
| `zoekTermInArtikelDom(doc, invoer, maxResultaten?)` | DOM-gebaseerde zoekfunctie; groepeert treffers per artikel; retourneert `{ artikelen, totaalTreffers, isVolledig }` |
| `escapeerRegex(str)` | Escapet regex-speciale tekens |
| `bouwTermPatroon(zoekterm)` | Bouwt regex-patroonstring met woordgrenzen en wildcard-ondersteuning |

### `src/bwb-parser/` (publieke API via `index.ts`)

| Export | Doel |
|--------|------|
| `parseBwbXml(xml, bwbId)` | XML string → `BwbNode` (RAW boom) |
| `parseElement(el, bwbId, parentPath)` | DOM-element → `BwbNode` |
| `normalizeNode(node)` | `BwbNode` → `NormalizedNode` |
| `extractPlainText(content)` | `ContentItem[]` → plain string |
| `transformToMcpLite(node, bwbId, citeertitel)` | `NormalizedNode` → `McpLiteNode[]` |
| `parseBwb(xml, bwbId, citeertitel?, versiedatum?)` | Volledige pipeline; geeft `ParseResult` terug |

### `src/shared/schemas.ts` — Zod contracts (source of truth)

| Schema | Type | Doel |
|--------|------|------|
| `ZoekInputSchema` | input | wettenbank_zoek — inclusief `.refine()` op minimaal één criterium |
| `ZoektermInputSchema` | input | wettenbank_zoekterm — incl. `includeerTekst: boolean` |
| `ArtikelInputSchema` | input | wettenbank_artikel |
| `StructuurInputSchema` | input | wettenbank_structuur |
| `ZoekOutputSchema` | output | `{ formaat, totaal, regelingen }` |
| `ZoektermOutputSchema` | output | `{ formaat, wet, artikelen[{artikel, aantalTreffers, leden, tekst?, formaat?}], ... }` |
| `ArtikelOutputSchema` | output | `{ formaat, citeertitel, pad?, sectie?, leden, bronreferentie, ... }` |
| `StructuurOutputSchema` | output | `{ formaat, bwbId, citeertitel, versiedatum, structuur }` |
| `StructuurNodeSchema` | output | Recursief schema voor structuurnodes |
| `FoutOutputSchema` | output | `{ fout: string }` — backwards-compatibel foutformaat |

---

## 6  XML-schemas als ontwerpbasis

De server laadt geen XSD-bestanden op, maar twee publieke schemas van `repository.officiele-overheidspublicaties.nl` vormen de stille blauwdruk achter de parselogica.

### BWB-toestand/2016-1 (`toestand_2016-1.xsd`)

Beschrijft de XML-structuur van wetsdocumenten die het repository serveert.

| Beslissing | XSD-grondslag |
|------------|---------------|
| Structurele container-types | `boek`, `deel`, `hoofdstuk`, `afdeling`, `paragraaf`, `wettekst`, `wetgeving`, `circulaire`, `circulaire-tekst` zijn XSD-elementnamen |
| Veldnamen in de parser | `kop`, `nr`, `al`, `lid`, `lidnr`, `lijst`, `li`, `tekst` zijn XSD-velden |
| Circulaire-structuur | Leidraad heeft `circulaire → circulaire-tekst → circulaire.divisie[]`; zonder `circulaire-tekst` worden Leidraad-artikelen niet gevonden |
| Mixed content (`<al>`) | `<al>`-elementen bevatten tekst gemengd met inline-elementen; gemodelleerd als `ContentItem[]` |

### BWB-WTI/2016-1 (`wti_2016-1.xsd`)

Beschrijft de recordstructuur die de SRU-zoekdienst teruggeeft.

```
gzd
  ├── originalData
  │     └── overheidbwb:meta
  │           ├── owmskern (dcterms:identifier, :title, :type, :modified; overheid:authority)
  │           └── bwbipm   (overheidbwb:rechtsgebied, :geldigheidsperiode_*)
  └── enrichedData
        └── overheidbwb:locatie_toestand   → repositoryUrl
```

---

## 7  Foutafhandeling

Alle tool-handlers zijn omgeven door een `try/catch` in `server.ts`. Zod-validatie vindt vóór de business-logica plaats. Alle foutresponses zijn **JSON**:

```json
{ "content": [{ "type": "text", "text": "{\"fout\": \"<message>\"}" }], "isError": true }
```

### Specifieke foutgevallen

| Situatie | Reactie |
|----------|---------|
| Ongeldige tool-invoer (Zod) | `{ "fout": "<Zod-foutbericht>" }` — vóór netwerkaanroep |
| Onbekend BWB-id (SRU geeft 0 records) | `{ "fout": "Geen regeling gevonden voor BWB-id: ..." }` |
| Repository niet bereikbaar (HTTP-fout) | `{ "fout": "Wetstekst repository onbereikbaar: <status>" }` |
| SRU HTTP-fout | `{ "fout": "SRU HTTP <status>" }` |
| Artikel niet gevonden | `{ "fout": "Artikel N niet gevonden." }` |
| Structuur leeg (geen containers, geen artikelen) | `structuur: []` — geen fout, valide leeg resultaat |

---

## 8  Installatie en configuratie

### Vereisten

- Node.js ≥ 18 (ESM-ondersteuning vereist)
- npm

### Bouwen

```bash
cd wettenbank-mcp
npm install
npm run build    # TypeScript compileren → dist/index.js
```

### Bekende BWB-ids

| Wet | BWB-id |
|-----|--------|
| Invorderingswet 1990 | `BWBR0004770` |
| Uitvoeringsbesluit Invorderingswet 1990 | `BWBR0004772` |
| Leidraad Invordering 2008 | `BWBR0024096` |
| Algemene wet inzake rijksbelastingen (AWR) | `BWBR0002320` |
| Algemene wet bestuursrecht (Awb) | `BWBR0005537` |
| Wet inkomstenbelasting 2001 | `BWBR0011353` |
| Wet op de vennootschapsbelasting 1969 | `BWBR0002672` |
| Wet op de omzetbelasting 1968 | `BWBR0002629` |
| Wet op de loonbelasting 1964 | `BWBR0002471` |

> **Let op:** BWB-id `BWBR0004800` is de *Leidraad invordering 1990* (verlopen per 2005-07-12) — niet gebruiken.

### Configuratie Claude Code CLI

In `.claude/settings.json` (project) of `~/.claude/settings.json` (globaal):

```json
{
  "mcpServers": {
    "wettenbank": {
      "command": "node",
      "args": ["/absoluut/pad/naar/wettenbank-mcp/dist/index.js"]
    }
  }
}
```

### Configuratie Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "wettenbank": {
      "command": "node",
      "args": ["/absoluut/pad/naar/wettenbank-mcp/dist/index.js"]
    }
  }
}
```

> Na het aanpassen van de configuratie moet Claude Code / Claude Desktop opnieuw worden gestart.

---

## 9  Ontwikkeling en testen

### Commando's

| Commando | Doel |
|----------|------|
| `npm run build` | TypeScript compileren naar `dist/` |
| `npm run dev` | Direct uitvoeren met `tsx` (zonder build-stap) |
| `npm start` | Gecompileerde server starten: `node dist/index.js` |
| `npm test` | Unit tests uitvoeren (Vitest, eenmalig) |
| `npm run test:watch` | Unit tests in watch-modus |

### Testdekking

Unit tests staan in `src/index.test.ts` (via `src/index.ts` re-exports) en `src/bwb-parser/mcp-lite.test.ts`.

**Testsuites:**

| Suite | Getest gedrag |
|-------|---------------|
| `escapeerRegex` | Speciale tekens escapen; gewone tekst ongewijzigd |
| `bouwTermPatroon` | Exacte woordgrens; suffix/prefix/infix-wildcard; speciale tekens |
| `parseZoekterm` | Enkelvoudig; EN/OF-operator; AND/OR-aliassen; wildcards doorgegeven; flags `g+i` |
| `stripXml` | Tags verwijderen; meerdere spaties samenvoegen |
| `parseRecords` | Leeg resultaat; enkel record; meerdere rechtsgebieden; twee records; `geldigTot`-fallback |
| `dedupliceerOpBwbId` | Unieke ids; meest recente versie; lege invoer; gemengde invoer |
| `haalWetstekstOp` | Peildatum vandaag/historisch; onbekend BWB-id; HTTP-fout; netwerkfout; `rawXml`/`doc`/`regeling` |
| `sruRequest` | HTTPS-gebruik; HTTP-foutcode; response-tekst |
| `zoekTermInArtikelDom` | Juist artikel; meerdere treffers; lege array; `<lid>`-tekst; woordgrens; wildcards; EN/OF; `isVolledig`; `totaalTreffers`; `maxResultaten` |
| `ZoekInputSchema` | Minimaal één criterium; peildatum-format; `maxResultaten`-bereik; defaults |
| `ZoektermInputSchema` | Verplichte velden; lege string; `maxResultaten`-default |
| `ArtikelInputSchema` | Verplichte velden; `null`-lid; lege artikel-string |
| `extraheerDocMetadata` | `citeertitel` + `versiedatum` uit `<toestand>`; lege strings als ontbreekt |
| `mcp-lite` (apart) | Artikel-rendering; lijsten; tabellen; inline links; sectie-paden |

### Bekende beperkingen

| Beperking | Toelichting |
|-----------|-------------|
| Vervallen artikelen | De SRU-dienst retourneert alleen geldende artikelen; gaten in de nummering zijn normaal |
| EU-verordeningen niet beschikbaar | Het Douanewetboek van de Unie en andere EU-regelgeving zit niet in het BWB |
| Leidraad-subartikelen | Subartikelen (bijv. `25.1`) zijn bereikbaar via `wettenbank_artikel`; hoofdartikel toont alleen de inleidende tekst |
| In-memory cache | De `xmlCache` wordt niet periodiek opgeschoond; bij langlopende processen kan geheugengebruik oplopen |
