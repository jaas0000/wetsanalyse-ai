# Wettenbank MCP — Documentatie

**Versie:** 2.1.0
**Taal:** TypeScript (ESM)
**Transportprotocol:** StdIO + HTTP (Streamable HTTP MCP)
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
| `wettenbank_artikel`     | Één artikel ophalen via BWB-id + artikelnummer; retourneert **JSON** met `leden` (incl. per lid de getagde `verwijzingen`), `pad`, `bronreferentie` en `formaat` |
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
├── index.ts                    # Entry point — transportkeuze (stdio/http) + startup + re-exports
├── server.ts                   # MCP Server — tool-definities en dispatcher (singleton + createServer)
│
├── http-server.ts              # Streamable-HTTP-transport — sessies, /mcp, /health (HTTP-modus)
├── auth.ts                     # Per-client bearer-tokens (leesClients, authenticeer)
├── oidc.ts                     # Optionele OIDC/JWT-bearer-validatie (dormant tenzij OIDC_ISSUER)
├── rate-limit.ts               # Token-bucket rate limiting per IP
├── logger.ts                   # Gestructureerde JSON-logging naar stderr (functioneel/audit/security)
├── build-info.ts               # Build-metadata (version/commit/builtAt) voor /health
│
├── clients/
│   ├── http.ts                 # Gedeelde fetch-helper: fetchMetRetry (timeout + retry/backoff)
│   ├── sru-client.ts           # SRU HTTP-client + XML-parsing
│   └── repository-client.ts    # BWB repo fetch + in-memory cache
│
├── search/
│   └── zoekterm-engine.ts      # Wildcard-regex + EN/OF-zoeklogica
│
├── tools/
│   ├── zoek.ts                 # wettenbank_zoek handler
│   ├── structuur.ts            # wettenbank_structuur handler
│   ├── artikel.ts              # wettenbank_artikel handler
│   └── zoekterm.ts             # wettenbank_zoekterm handler
│
├── shared/
│   ├── schemas.ts              # Zod input/output schemas — source of truth
│   └── utils.ts                # Gedeelde helpers (detecteerFormaat)
│
└── bwb-parser/
    ├── index.ts                # Publieke API + parseBwb() pipeline
    ├── types.ts                # TypeScript type-definities RAW/NORMALIZED/MCP-LITE
    ├── parser.ts               # XML DOM → RAW BwbNode-boom
    ├── normalizer.ts           # RAW → NORMALIZED structuur
    └── mcp-lite.ts             # NORMALIZED → token-efficiënte Markdown-JSON
```

> De top-level `http-server.ts`, `auth.ts`, `oidc.ts`, `rate-limit.ts`, `logger.ts` en
> `build-info.ts` horen bij het **HTTP-transport**; het lokale stdio-pad raakt ze niet aan.
> Zie [§8](#8-installatie-en-configuratie) en `SECURITY.md` voor de HTTP-deployment.

### Communicatiemodel

De server kent **twee transports** (zelfde tool-logica eronder), gekozen in `index.ts` via
`MCP_TRANSPORT` (env) of `--transport <modus>` (CLI-flag); default is `stdio`:

- **stdio** (default) — de client start de server als subproces en wisselt JSON-RPC uit over
  stdin/stdout. Gebruikt de singleton `server` uit `server.ts`.
- **http** (`MCP_TRANSPORT=http`) — langlevende netwerkservice via Streamable HTTP
  (`http-server.ts`, Node-stdlib): sessiebeheer op `/mcp`, `/health` (auth-vrij), bearer-auth,
  rate limiting en gestructureerde logging. Bedoeld voor de gecontaineriseerde deployment
  (zie [§8](#8-installatie-en-configuratie) en `SECURITY.md`).

Het tool-dispatcherpad is in beide transports identiek:

```
Claude Code (LLM)
      │  tool call (JSON-RPC over stdio of HTTP)
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

      ▲  tool result (JSON-RPC over stdio of HTTP)
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

`repository-client.ts` beheert een `xmlCache: Map<string, CacheEntry>` met TTL van 1 uur. Sleutel: de **toestand-URL** (`locatie_toestand`); een aliasmap vertaalt `"bwbId|peildatum"` naar die URL, zodat verschillende peildata die naar dezelfde toestand wijzen één entry delen. Verlopen entries worden elk uur opgeschoond via een `setInterval(...).unref()`. Naast de TTL gelden twee grenzen: een **LRU-cap** (`MAX_CACHE_ENTRIES = 50`) en een **totaal-bytebudget** (`WETTENBANK_CACHE_MAX_BYTES`, default 64 MB rauwe XML) met LRU-evictie tot de nieuwe entry past — juist grote wetten (bijv. Omgevingswet) worden zo wél gecachet, want die opnieuw downloaden en parsen is duurder dan het geheugen.

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

Minimaal één zoekcriterium is vereist (Zod `.refine()`). Meerwoordige titels zoeken met CQL `all` (alle woorden moeten voorkomen); één woord met `any`. `totaal` telt de geretourneerde (gededupliceerde) regelingen, `totaalBeschikbaar` het brontotaal (SRU `numberOfRecords`); `isVolledig: false` betekent dat het resultaat is afgekapt — verfijn de zoekopdracht.

**Resultaatformaat (JSON):**

```json
{
  "formaat": "plain",
  "totaal": 2,
  "totaalBeschikbaar": 2,
  "isVolledig": true,
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
| `peildatum` | string |           | Datum `YYYY-MM-DD` (standaard: vandaag, Europe/Amsterdam) |
| `diepte`    | number |           | Beperk de boom tot dit aantal niveaus; afgekapte nodes krijgen `ingekort: true` |
| `sectie`    | string |           | Toon alleen de sectie(s) met dit nummer of deze titel(-substring) |

**Resultaatformaat (JSON):**

```json
{
  "formaat": "plain",
  "bwbId": "BWBR0004770",
  "citeertitel": "Invorderingswet 1990",
  "type": "wet",
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
  "type": "wet",
  "versiedatum": "2024-01-01",
  "bwbId": "BWBR0004770",
  "artikel": "9",
  "sectie": "Artikel 9",
  "pad": "Hoofdstuk II > Afdeling 1 > Artikel 9",
  "leden": [
    {
      "lid": "1",
      "tekst": "Een belastingaanslag is invorderbaar zes weken na de dagtekening van het aanslagbiljet.",
      "bronreferentie": "jci1.3:c:BWBR0004770&artikel=9&lid=1&g=2024-01-01"
    },
    {
      "lid": "2",
      "tekst": "In afwijking van het eerste lid is een navorderingsaanslag, ... als bedoeld in [artikel 4 van de Algemene wet bestuursrecht](jci1.3:c:BWBR0005537&artikel=4) ...",
      "bronreferentie": "jci1.3:c:BWBR0004770&artikel=9&lid=2&g=2024-01-01",
      "verwijzingen": [
        {
          "soort": "extref",
          "target": "jci1.3:c:BWBR0005537&artikel=4",
          "label": "artikel 4 van de Algemene wet bestuursrecht",
          "bwbIdDoel": "BWBR0005537",
          "extern": true
        }
      ]
    }
  ],
  "bronreferentie": "jci1.3:c:BWBR0004770&artikel=9&g=2024-01-01"
}
```

**`formaat`-veld:** `"markdown"` als de tekst Markdown-syntax bevat (tabellen `|...|`, genummerde lijsten `1.`, letterlijsten `a.`, streepjes `–`); anders `"plain"`. Stelt een LLM in staat de tekst correct te renderen.

**`pad`-veld:** Volledig hiërarchisch pad als compacte string. Alleen aanwezig als het artikel structuurancestors heeft.

**`leden`-array:** Één entry per genummerd lid. Bij artikelen zonder genummerde leden (bijv. Leidraad `circulaire.divisie`) één entry met `lid: ""`.

**`verwijzingen`-array (per lid, optioneel):** De uitgaande **getagde** verwijzingen (`<intref>`/`<extref>`) van dat lid, als zelfstandig veld náást de Markdown-links in `tekst`. Per verwijzing: `soort` (`intref`/`extref`), `target` (de ruwe `@doc`/`@reeks`-waarde — JCI-uri of BWB-id, *opaque*; er wordt géén artikel/lid uit gedestilleerd), `label` (linktekst), `bwbIdDoel` (BWB-id indien eenduidig herleidbaar) en `extern` (`true` als het naar een andere regeling dan `bwbId` wijst). Het veld ontbreekt als het lid geen getagde verwijzingen bevat. Let op: natuurlijke-taalverwijzingen zonder XML-tag ("het eerste lid") worden hier **niet** gevangen — dat blijft aan de consument (de skill/API herkent ze in de tekst).

Artikelnummers matchen case-insensitief en getrimd (`"9A"` vindt `"9a"`). Komt hetzelfde nummer meerdere keren voor (bijv. opnieuw genummerde bijlage), dan wordt het eerste exemplaar gebruikt en meldt een `waarschuwing`-veld dat.

Artikel of lid niet gevonden geeft een **fout** (MCP `isError`) met een actionable melding, bijv. `{ "fout": "Artikel 999 niet gevonden in BWBR0004770 (peildatum 2024-01-01). Bestaat wel: 9, 9a. Roep wettenbank_structuur aan voor de geldige artikelnummers; ...", "klasse": "client" }` — nooit een stil leeg `leden`-array.

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
  "citeertitel": "Invorderingswet 1990",
  "versiedatum": "2024-01-01",
  "bwbId": "BWBR0004770",
  "zoekterm": "dwangbevel",
  "totaalTreffers": 12,
  "isVolledig": true,
  "aantalArtikelen": 4,
  "artikelen": [
    { "artikel": "13", "aantalTreffers": 5, "leden": ["1", "3"],
      "bronreferentie": "jci1.3:c:BWBR0004770&artikel=13&g=2024-01-01" },
    { "artikel": "14", "aantalTreffers": 3, "leden": [],
      "bronreferentie": "jci1.3:c:BWBR0004770&artikel=14&g=2024-01-01" }
  ]
}
```

**Met `includeerTekst: true`** bevat elk artikel-object ook:

```json
{
  "artikel": "13",
  "aantalTreffers": 5,
  "leden": ["1", "3"],
  "bronreferentie": "jci1.3:c:BWBR0004770&artikel=13&g=2024-01-01",
  "pad": "Hoofdstuk III > Artikel 13",
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
| MCP-LITE | `McpLiteNode` | `{ bwbId, citeertitel, sectie, tekst, bronreferentie, verwijzingen? }` |
| MCP-LITE | `VerwijzingRef` | `{ soort, target, label, bwbIdDoel?, extern }` — één getagde intref/extref |

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

### `src/clients/http.ts`

| Functie/export | Doel |
|----------------|------|
| `fetchMetRetry(url, init?, opts?)` | Gedeelde `fetch` met per-poging-timeout (`AbortController`, default 15s) en retry met exponentiële backoff + jitter; herprobeert **alleen** transiënte fouten (netwerk/timeout + HTTP 502/503/504). 2xx/4xx/500 gaan direct terug — de aanroeper bepaalt via `res.ok` wat een fout is. Gebruikt door `sru-client.ts` en `repository-client.ts`. |

### `src/clients/sru-client.ts`

| Functie/export | Doel |
|----------------|------|
| `sruRequest(query, maxRecords?)` | HTTP GET naar SRU-zoekdienst (via `fetchMetRetry`); geeft raw XML terug |
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

### `src/shared/utils.ts`

| Functie/export | Doel |
|----------------|------|
| `detecteerFormaat(tekst)` | Bepaalt `"plain"` of `"markdown"` (tabellen, genummerde/letter-/streepjeslijsten); gedeeld door `wettenbank_artikel` en `wettenbank_zoekterm` |

### HTTP-transport en enterprise-modules

Deze modules zijn alleen actief in **HTTP-modus** (`MCP_TRANSPORT=http`). Het volledige
overzicht van env-vars, logvelden, bewaartermijnen en hardening staat in **`SECURITY.md`**.

| Module | Doel |
|--------|------|
| `http-server.ts` | Streamable-HTTP-transport: sessiebeheer per `mcp-session-id` met idle-opruiming, `/mcp` (POST/GET/DELETE), `/health` (auth-vrij, geeft build-info), 1 MB body-cap, securityheaders |
| `auth.ts` | Per-client bearer-tokens (`leesClients`, `authenticeer`); constant-tijd vergelijking; tokens uit env (`MCP_AUTH_TOKENS`/`MCP_AUTH_TOKEN`) of bestand (`*_FILE`) |
| `oidc.ts` | Optionele OIDC/JWT-bearer-validatie via JWKS (`jose`); dormant tenzij `OIDC_ISSUER` is gezet; statische tokens blijven fallback |
| `rate-limit.ts` | Token-bucket per IP (`MCP_RATE_BURST`/`MCP_RATE_PER_MIN`); client-IP via XFF met `MCP_TRUSTED_PROXY_HOPS` |
| `logger.ts` | Gestructureerde JSON-logging naar stderr; categorieën `functioneel`/`audit`/`security`; tokens en rauwe zoektermen worden nooit gelogd |
| `build-info.ts` | Build-metadata (`version`, `commit`, `builtAt`) voor de `/health`-respons |

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

De server kent twee draaiwijzen: **lokaal (stdio)** als subproces, of **remote (HTTP)** als
gedeelde gecontaineriseerde service. Kies de configuratie die past.

#### A. Lokaal — stdio (Claude Code CLI)

In `.claude/settings.json` (project) of `~/.claude/settings.json` (globaal):

```json
{
  "mcpServers": {
    "wettenbank": {
      "command": "node",
      "args": ["tools/wettenbank-mcp/dist/index.js"]
    }
  }
}
```

> Projectrelatief pad de voorkeur boven een absoluut pad, zodat de map portabel blijft.

#### B. Lokaal — stdio (Claude Desktop)

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

#### C. Remote — HTTP (gedeelde server)

Verwijs naar een draaiende HTTP-instantie; de bearer-token komt via env-expansie zodat hij
**niet** in de repo belandt:

```json
{
  "mcpServers": {
    "wettenbank": {
      "type": "http",
      "url": "https://wettenbank-mcp.ipalm.nl/mcp",
      "headers": { "Authorization": "Bearer ${WETTENBANK_TOKEN}" }
    }
  }
}
```

> Na het aanpassen van de configuratie moet Claude Code / Claude Desktop opnieuw worden gestart.

### Remote deployment (Docker)

Voor de gedeelde HTTP-service:

- **`Dockerfile`** — multi-stage, non-root, `HEALTHCHECK` op `/health`, default
  `MCP_TRANSPORT=http`. Build-context = deze map: `docker build -t wettenbank-mcp tools/wettenbank-mcp`.
- **`docker-compose.yml`** — Portainer-stack achter Nginx Proxy Manager: géén host-poort, de
  container hangt op het gedeelde NPM-netwerk (`PROXY_NETWORK`); NPM proxyt
  `wettenbank-mcp.ipalm.nl` → `wettenbank-mcp:3000` met TLS. `MCP_AUTH_TOKENS` als stack-env.
- **CI** (`.github/workflows/docker-publish.yml`) — bouwt en pusht
  `ghcr.io/<owner>/wettenbank-mcp`; lokaal hoeft geen Docker-engine aanwezig te zijn.

In HTTP-modus is de start **fail-closed**: zonder geconfigureerde auth weigert `index.ts` te
starten, tenzij `MCP_ALLOW_NO_AUTH=1`. De volledige lijst env-vars (auth, OIDC, rate limiting,
logging) en de hardening staan in **`SECURITY.md`**.

> **Wil je alleen het kant-en-klare image draaien** (zonder deze repo of build)? Het image
> `ghcr.io/palmw01/wettenbank-mcp:latest` is publiek trekbaar en bevat geen tokens of
> infra-namen. Zie **`HANDLEIDING-IMAGE.md`** voor een beknopte stap-voor-stap met
> placeholders.

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

Unit tests (Vitest) staan verspreid over acht bestanden:

- `src/index.test.ts` — de tool-/parser-/zoeklogica via de `src/index.ts` re-exports
- `src/bwb-parser/mcp-lite.test.ts` — de mcp-lite-rendering
- HTTP-/enterprise-modules: `src/auth.test.ts`, `src/oidc.test.ts`,
  `src/rate-limit.test.ts`, `src/logger.test.ts`, `src/http-server.test.ts`,
  `src/build-info.test.ts`

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
| `auth` (apart) | Per-client token-parsing; constant-tijd vergelijking; file-based tokens; legacy fallback |
| `oidc` (apart) | OIDC-config uit env; JWT-validatie; clientId-claim; fallback op statische tokens |
| `rate-limit` (apart) | Token-bucket per IP; burst/aanvulsnelheid; XFF-keuze via trusted-proxy-hops |
| `logger` (apart) | JSON-logregels; categorieën; redactie van tokens en rauwe zoektermen |
| `http-server` (apart) | Sessiebeheer; `/health` (auth-vrij); auth-weigering; body-cap; securityheaders |
| `build-info` (apart) | Build-metadata (`version`/`commit`/`builtAt`) voor `/health` |

### Bekende beperkingen

| Beperking | Toelichting |
|-----------|-------------|
| Vervallen artikelen | De SRU-dienst retourneert alleen geldende artikelen; gaten in de nummering zijn normaal |
| EU-verordeningen niet beschikbaar | Het Douanewetboek van de Unie en andere EU-regelgeving zit niet in het BWB |
| Leidraad-subartikelen | Subartikelen (bijv. `25.1`) zijn bereikbaar via `wettenbank_artikel`; hoofdartikel toont alleen de inleidende tekst |
| In-memory cache | Groeit maximaal tot `MAX_CACHE_ENTRIES` entries (LRU) × `MAX_XML_BYTES` (5 MB) per entry; verlopen entries worden elk uur opgeschoond. Geheugengebruik is begrensd maar kan in het worst-case nog altijd meerdere honderden MB bedragen. |
