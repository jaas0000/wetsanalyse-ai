# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript → dist/
npm run dev        # Run directly with tsx (no build needed)
npm start          # Run compiled server: node dist/index.js
npm test           # Run unit tests (vitest)
npm run test:watch # Watch mode
```

Unit tests staan in `src/index.test.ts` (vitest) en `src/bwb-parser/mcp-lite.test.ts`. Alle geëxporteerde functies zijn gedekt. Draai `npm test` voor een commit.

## Architecture

This is a **Model Context Protocol (MCP) server** that gives Claude Desktop access to Dutch legislation via the public SRU API at `zoekservice.overheid.nl`. No API key required — data is CC-0.

### File structure

```
src/
├── index.ts                 # Entry point — startup + backward-compat re-exports
├── server.ts                # MCP Server — tool definitions + dispatcher
├── clients/
│   ├── sru-client.ts        # SRU HTTP client + XML parse (sruRequest, parseRecords, etc.)
│   └── repository-client.ts # BWB repo fetch + xmlCache + extraheerDocMetadata
├── search/
│   └── zoekterm-engine.ts   # Wildcard regex + EN/OF boolean search logic
├── tools/
│   ├── zoek.ts              # wettenbank_zoek handler
│   ├── structuur.ts         # wettenbank_structuur handler
│   ├── artikel.ts           # wettenbank_artikel handler
│   └── zoekterm.ts          # wettenbank_zoekterm handler
├── shared/
│   ├── schemas.ts           # Zod input/output schemas — single source of truth
│   └── utils.ts             # Gedeelde helpers (detecteerFormaat)
└── bwb-parser/              # XML → structured data pipeline (see below)
```

### Tools

| Tool | Purpose |
|------|---------|
| `wettenbank_zoek` | Search by title, rechtsgebied, ministerie, or regelingsoort — returns `{ formaat, totaal, regelingen[] }` |
| `wettenbank_structuur` | Table of contents of a law — returns `{ formaat, structuur[] }` (no article text) |
| `wettenbank_artikel` | Fetch one article — returns `{ formaat, citeertitel, pad?, sectie?, leden[], bronreferentie }` |
| `wettenbank_zoekterm` | Full-text search within a law — returns `{ formaat, artikelen[{artikel, aantalTreffers, leden, tekst?, formaat?}] }` with optional `includeerTekst` |

All tools return **pure JSON** serialized as a string in the MCP `text` content block. Every response includes `formaat: "plain" | "markdown"` so the LLM knows how to render the text.

### JSON output conventions

- `formaat: "plain"` — tekst is plain text
- `formaat: "markdown"` — tekst bevat Markdown (tabellen, lijsten, links)
- `pad` — volledig hiërarchisch pad als string, bijv. `"Hoofdstuk II > Afdeling 1 > Artikel 9"`
- `bronreferentie` — JCI-uri, bijv. `jci1.3:c:BWBR0004770&artikel=9`

### Validation

Every tool handler calls `ZodSchema.safeParse()` on input before any network calls. Errors return `{ "fout": "<message>" }` (backwards-compatible).

### XML parsing

Uses `@xmldom/xmldom` (`DOMParser`) throughout. Mixed-content elements (`<al>`, `<entry>`) are modelled as `ContentItem[]` (string | InlineNode). No `fast-xml-parser` dependency.

### In-memory cache

`xmlCache` in `repository-client.ts` (exported `Map<string, CacheEntry>`, 1-hour TTL) caches raw XML + parsed `Document` per BWB-id + date combination. Verlopen entries worden automatisch elk uur verwijderd via een `setInterval(...).unref()` zodat de cache niet onbegrensd groeit.

### HTTP timeouts

Beide HTTP clients (`sruRequest` in `sru-client.ts` en `haalWetstekstOp` in `repository-client.ts`) gebruiken een `AbortController` met 15 seconden timeout. Na afloop wordt de timer altijd gecleard via `finally { clearTimeout(timeoutId) }`.

### Data flow

**wettenbank_zoek:** `ZoekInputSchema.safeParse()` → build CQL query → `sruRequest()` → `parseRecords()` + `dedupliceerOpBwbId()` → JSON.

**wettenbank_structuur:** `StructuurInputSchema.safeParse()` → `haalWetstekstOp()` → `parseBwbXml()` + `normalizeNode()` → traverse NormalizedNode tree → extract structural containers + article numbers → JSON.

**wettenbank_artikel:** `ArtikelInputSchema.safeParse()` → `haalWetstekstOp()` (checks `xmlCache`) → `extraheerDocMetadata()` → `zoekElementInDom()` → `parseElement()` + `normalizeNode()` + `transformToMcpLite()` → detect formaat → JSON.

**wettenbank_zoekterm:** `ZoektermInputSchema.safeParse()` → `haalWetstekstOp()` → `zoekTermInArtikelDom()` via `parseZoekterm()` → if `includeerTekst`: per article `parseElement()` + `normalizeNode()` + `transformToMcpLite()` → JSON.

### bwb-parser module (`src/bwb-parser/`)

Three-layer transformation pipeline:

```
XML string
   ↓ parseBwbXml() / parseElement()
BwbNode (RAW) — direct DOM representation, mixed-content as ContentItem[]
   ↓ normalizeNode()
NormalizedNode — structured tree (NormalizedArtikel, NormalizedContainer, NormalizedLijst, NormalizedTable)
   ↓ transformToMcpLite()
McpLiteNode[] — token-efficient, Markdown text, one node per lid
```

Key exports from `bwb-parser/index.ts`:

| Export | Purpose |
|--------|---------|
| `parseElement(el, bwbId, parentPath)` | DOM Element → raw `BwbNode` |
| `normalizeNode(node)` | `BwbNode` → `NormalizedNode` |
| `transformToMcpLite(node, bwbId, citeertitel)` | `NormalizedNode` → `McpLiteNode[]` |
| `parseBwb(xml, bwbId, citeertitel?, versiedatum?)` | Full pipeline; returns `ParseResult` |

`McpLiteNode` has: `bwbId`, `citeertitel`, `sectie`, `tekst`, `bronreferentie`.

### `wettenbank_zoekterm` — wildcards and operators

`bouwTermPatroon(zoekterm)` converts a search term to a regex pattern:

| Input | Regex | Matches |
|-------|-------|---------|
| `termijn` | `\btermijn\b` | exact word only |
| `termijn*` | `\btermijn\w*` | `termijn`, `termijnen`, `termijnoverschrijding` |
| `*termijn` | `\w*termijn\b` | `termijn`, `betalingstermijn` |
| `*termijn*` | `\w*termijn\w*` | anything containing `termijn` |

`parseZoekterm(zoekterm)` normalises ` AND ` → ` EN ` and ` OR ` → ` OF `, splits on ` EN ` or ` OF `, and returns `ZoekInput { patronen: RegExp[], operator: "EN"|"OF" }`. With EN, only articles where all patterns occur are returned. Patterns carry the `gi` flags; `pat.lastIndex` is explicitly reset to `0` before every `.match()` / `.test()` call to prevent stateful drift when the same instance is reused across articles.

Special characters are pre-escaped via `escapeerRegex()`.

### XML schemas as design basis

Two public schemas from `repository.officiele-overheidspublicaties.nl` are the silent blueprint behind the parsing logic:

**`BWB-toestand/2016-1`** — structural container types used in `zoekElementInDom` and `bouwStructuurNodes`: `boek`, `deel`, `hoofdstuk`, `afdeling`, `paragraaf`, `wettekst`, `wetgeving`, `circulaire`, `circulaire-tekst`. Note `circulaire-tekst`: the Leidraad has `circulaire → circulaire-tekst → circulaire.divisie[]`; without this level, all Leidraad articles would not be found. Field names parsed by `bwb-parser`: `kop`, `nr`, `al`, `lid`, `lidnr`, `lijst`, `li`, `tekst`.

**`BWB-WTI/2016-1`** — record structure returned by the SRU service. Path names in `parseRecords()` are WTI-XSD elements and namespaces: `gzd → originalData → overheidbwb:meta → owmskern (dcterms:*, overheid:*)` and `enrichedData → overheidbwb:locatie_toestand`.

**Communication:** twee transports, gekozen in `dist/index.js` op basis van `MCP_TRANSPORT` (env) of `--transport <modus>` (CLI-flag); default is `stdio`.

- **stdio** (default) — de client start de server als subproces en wisselt JSON uit over stdin/stdout via `StdioServerTransport`. Gebruikt de singleton `server` uit `server.ts`.
- **http** (`MCP_TRANSPORT=http`) — langlevende netwerkservice via `StreamableHTTPServerTransport` op `0.0.0.0:${PORT:-3000}`, endpoint `/mcp`. Code in `http-server.ts` (Node-stdlib `http`, geen extra dependency): sessiebeheer per `mcp-session-id`, een verse `createServer()`-instantie per sessie, `/health` (200, geen auth) en optionele bearer-auth via `MCP_AUTH_TOKEN`. Bedoeld voor de gecontaineriseerde deployment.

Entry point is `dist/index.js` (re-exports + startup); de serverlogica zit in `dist/server.js`, het HTTP-transport in `dist/http-server.js`.

## Deployment

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wettenbank": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

**Claude Code CLI (lokaal, stdio)** — add to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "wettenbank": {
      "command": "node",
      "args": ["/absolute/path/to/wettenbank-mcp/dist/index.js"]
    }
  }
}
```

**Remote (HTTP) via Docker** — voor een gedeelde, gecontaineriseerde server.

- `Dockerfile` (multi-stage, non-root, `HEALTHCHECK` op `/health`, default `MCP_TRANSPORT=http`). Build-context = deze map: `docker build -t wettenbank-mcp tools/wettenbank-mcp`.
- `docker-compose.yml` — Portainer-stack achter Nginx Proxy Manager: géén host-poort, container op het gedeelde NPM-netwerk (`PROXY_NETWORK`), NPM proxyt `wettenbank-mcp.ipalm.nl` → `wettenbank-mcp:3000` met TLS. `MCP_AUTH_TOKEN` als stack-env.
- `.github/workflows/docker-publish.yml` — bouwt en pusht `ghcr.io/<owner>/wettenbank-mcp` (CI is de build-route; lokaal hoeft geen Docker-engine aanwezig te zijn).

Client-config (`.mcp.json`), met de token via env-expansie zodat hij niet in de repo belandt:

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
