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

Unit tests staan in `src/*.test.ts`, `src/bwb-parser/*.test.ts` en `src/tools/*.test.ts` (vitest).
Bijzonder: `src/bwb-parser/brongetrouwheid.test.ts` draait een **round-trip-invariant** ("geen
tekstnode uit de bron raakt zoek") tegen de schema-getrouwe fixture
`src/bwb-parser/fixtures/toestand-fixture.xml`, en `src/tools/handlers.test.ts` valideert elke
handler-respons tegen de OutputSchema's (contract-drift faalt dus in de test). Draai `npm test`
voor een commit. CI bevat bovendien een dist-staleness-check: bouw en commit `dist/` mee.

## Architecture

This is a **Model Context Protocol (MCP) server** that gives Claude Desktop access to Dutch legislation via the public SRU API at `zoekservice.overheid.nl`. No API key required — data is CC-0.

### File structure

```
src/
├── index.ts                 # Entry point — transportkeuze (stdio/http) + startup + re-exports
├── server.ts                # MCP Server — tool definitions + dispatcher (singleton + createServer)
├── http-server.ts           # Streamable-HTTP-transport — sessies, /mcp, /health (HTTP-modus)
├── auth.ts                  # Per-client bearer-tokens (leesClients, authenticeer)
├── oidc.ts                  # Optionele OIDC/JWT-bearer-validatie (dormant tenzij OIDC_ISSUER)
├── rate-limit.ts            # Token-bucket rate limiting per IP
├── logger.ts                # Gestructureerde JSON-logging naar stderr (functioneel/audit/security)
├── build-info.ts            # Build-metadata (version/commit/builtAt) voor /health
├── clients/
│   ├── http.ts              # Gedeelde fetch-helper: fetchMetRetry (timeout + retry/backoff)
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

De top-level `http-server.ts`, `auth.ts`, `oidc.ts`, `rate-limit.ts`, `logger.ts` en
`build-info.ts` horen bij het **HTTP-transport** (zie *Communication* en *Logging &
beveiliging* verderop); het stdio-pad raakt ze niet aan.

### Tools

| Tool | Purpose |
|------|---------|
| `wettenbank_zoek` | Search by title, rechtsgebied, ministerie, or regelingsoort — returns `{ formaat, totaal, totaalBeschikbaar, isVolledig, regelingen[] }`. `totaal` = de (ontdubbelde) regelingen in dít antwoord; `totaalBeschikbaar` = bij afkapping het brontotaal (ruwe SRU `numberOfRecords`), bij `isVolledig` gelijk aan `totaal` (invariant: `totaalBeschikbaar >= totaal`); `isVolledig=false` = afgekapt. Meerwoordige titels zoeken met CQL `all` (alle woorden) i.p.v. `any`. |
| `wettenbank_structuur` | Table of contents of a law — returns `{ formaat, type?, structuur[] }` (no article text). Optionele inputs `diepte` (afgekapte nodes krijgen `ingekort: true`) en `sectie` (filter op nr of titel-substring) voor zeer grote wetten. |
| `wettenbank_artikel` | Fetch one article — returns `{ formaat, citeertitel, type?, pad?, sectie?, leden[{lid, tekst, bronreferentie, verwijzingen?}], bronreferentie, waarschuwing? }`. Per lid is `verwijzingen` (optioneel) de lijst getagde intref/extref met `{soort, target, label, bwbIdDoel?, extern}` — náást de inline-Markdown-links in `tekst` (zie *bwb-parser*). Artikelnummers matchen case-insensitief/getrimd; bij dubbele nummers (bijlage) wordt het eerste exemplaar gebruikt mét `waarschuwing`. |
| `wettenbank_zoekterm` | Full-text search within a law — returns `{ formaat, citeertitel, artikelen[{artikel, aantalTreffers, leden, bronreferentie, pad?, tekst?, formaat?}] }`; `pad`/`tekst` alleen bij `includeerTekst=true` |

De JSON-**inputschema's** van de tools worden bij `ListTools` gegenereerd uit de Zod-schema's in
`shared/schemas.ts` (`z.toJSONSchema` via `alsJsonSchema` in `server.ts`) — één bron van waarheid,
dus descriptions/limieten/defaults in Zod onderhouden, niet in `server.ts`.

All tools return **pure JSON** serialized as a string in the MCP `text` content block. Every response includes `formaat: "plain" | "markdown"` so the LLM knows how to render the text.

### JSON output conventions

- `formaat: "plain"` — tekst is plain text
- `formaat: "markdown"` — tekst bevat Markdown (tabellen, lijsten, links)
- `pad` — volledig hiërarchisch pad als string, bijv. `"Hoofdstuk II > Afdeling 1 > Artikel 9"`
- `bronreferentie` — JCI-uri, lid- en versiespecifiek waar mogelijk, bijv.
  `jci1.3:c:BWBR0004770&artikel=9&lid=2&g=2024-01-01` (traceerbaarheidseis van de methode)

### Validation & foutkanaal

Every tool handler calls `ZodSchema.safeParse()` on input before any network calls. Bij een
validatiefout worden **álle** issues mét veldpad samengevoegd (`formatteerZodFout` in
`shared/utils.ts`) en als `ClientInputError` gegooid (foutklasse `client`). Ook "artikel niet
gevonden" en "lid niet gevonden" gooien een `ClientInputError` met een actionable melding
(suggesties + verwijzing naar `wettenbank_structuur` resp. de beschikbare lidnummers) — er is dus
één foutkanaal: alle fouten komen als `{ "fout", "foutCode"?, "klasse"? }` met MCP `isError: true`
terug; een leeg-maar-geldig resultaat is nooit een stil substituut voor een fout.

De default-peildatum (`vandaag()` in `shared/utils.ts`) gebruikt **Europe/Amsterdam**, niet de
servertijdzone (de container draait in UTC).

### XML parsing

Uses `@xmldom/xmldom` (`DOMParser`) throughout. Mixed-content elements (`<al>`, `<entry>`) are modelled as `ContentItem[]` (string | InlineNode). No `fast-xml-parser` dependency.

### In-memory cache

`xmlCache` in `repository-client.ts` (exported `Map<string, CacheEntry>`, 1-hour TTL) caches raw
XML + parsed `Document` **per toestand-URL** (`locatie_toestand`); een tweede map (`datumAlias`)
vertaalt `bwbId|datum` naar die URL. Twee peildata die naar dezelfde toestand wijzen delen zo één
entry, en een alias-hit kost geen SRU-roundtrip. Verlopen entries worden elk uur verwijderd via een
`setInterval(...).unref()`; daarnaast gelden een **LRU-cap** (`MAX_CACHE_ENTRIES`) én een
**totaal-bytebudget** (`WETTENBANK_CACHE_MAX_BYTES`, default 64 MB rauwe XML) met LRU-evictie tot
de nieuwe entry past. Juist grote wetten (Omgevingswet) worden dus wél gecachet — herhaald
downloaden/parsen daarvan is duurder dan het geheugen.

### HTTP-client (timeouts & retry)

Beide upstream-clients (`sruRequest` in `sru-client.ts` en `haalWetstekstOp` in
`repository-client.ts`) fetchen via de **gedeelde** `fetchTekstMetRetry` in `clients/http.ts`,
die de body bínnen het per-poging-timeout-venster leest (een upstream die snel headers maar
druppelsgewijs de body stuurt kan dus niet blijven hangen) en een identificerende `User-Agent`
meestuurt. De tool-deadline in `server.ts` geeft een `AbortSignal` door tot in de fetches:
bij `TOOL_TIMEOUT` worden lopende requests echt geannuleerd i.p.v. op de achtergrond door te
lopen.
De bronnen van overheid.nl zijn berucht traag/wisselvallig, dus per poging geldt een
`AbortController`-timeout (default 15s, gecleard in `finally`) en wordt **alleen bij
transiënte fouten** herprobeerd: netwerk-/timeout-fouten en de gatewaystatussen
**502/503/504**, met exponentiële backoff + jitter (default 3 pogingen). Niet-transiënte
antwoorden (2xx, maar ook 4xx en 500) gaan direct terug; de aanroeper bepaalt zelf via
`res.ok` wat een fout is, zodat de bestaande foutmeldingen (`"SRU HTTP <status>"`,
`"…timeout na 15s"`) behouden blijven. Malformed/lege XML-responses gaan via
`parseXmlDoc()` en geven een expliciete fout (geen stil leeg resultaat).

### Data flow

**wettenbank_zoek:** `ZoekInputSchema.safeParse()` → build CQL query → `sruRequest()` → `parseRecords()` + `dedupliceerOpBwbId()` → JSON.

**wettenbank_structuur:** `StructuurInputSchema.safeParse()` → `haalWetstekstOp()` → `parseBwbVanDom()` (hergebruikt het gecachete `Document` — geen tweede DOM-parse) + `normalizeNode()` → traverse NormalizedNode tree → extract structural containers + article numbers → optionele `sectie`/`diepte`-filters → JSON.

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

`McpLiteNode` has: `bwbId`, `citeertitel`, `sectie`, `tekst`, `bronreferentie`, and optional
`verwijzingen: VerwijzingRef[]`. De inline `<intref>`/`<extref>`-elementen renderen als
Markdown-links `[label](target)` in `tekst` (in `renderContent`); `verzamelVerwijzingenUitNode`
oogst ze daarnaast als gestructureerde `VerwijzingRef[]` (`soort`, `target` opaque, `label`,
`bwbIdDoel?`, `extern`) zodat een consument ze als zelfstandig gegeven kan inventariseren. De
collector spiegelt de render-logica (blocks winnen van content) om dubbeltelling te vermijden.

**Brongetrouwheid in de normalisatie/render-stap (let op bij wijzigen):**

- Whitespace-only tekstnodes tussen inline-elementen (bv. twee opeenvolgende `<extref>`'s) worden
  als één spatie behouden (`parser.ts`); `<br/>` rendert als spatie. Lijsten renderen **recursief**
  (élke diepte, a → 1° → i); een `<table>` binnen een `<li>` zit in `NormalizedListItem.blocks` en
  wordt ná de itemtekst gerenderd; een aanhef-`<al>` naast `<lid>`-kinderen wordt een ongenummerd
  lid vóór de genummerde leden. Dit alles wordt geborgd door `brongetrouwheid.test.ts`
  (round-trip-invariant) — laat die meedraaien bij elke parserwijziging.

- `NormalizedLid` heeft naast `content`/`tekst`/`children` ook `blocks` — alle content-blokken
  (`al`, `lijst`, `table`, …) in **documentvolgorde**. `transformToMcpLite` rendert uit `blocks`,
  zodat de interleave *tekst → tabel/lijst → tekst* binnen een lid behouden blijft. `content`/`tekst`
  blijven de platte concatenatie van uitsluitend de `al`-blokken (voor zoekbaarheid).
- `circulaire.divisie` wordt **recursief** genormaliseerd: een divisie krijgt zijn eigen content als
  lid(eren) plus `subdivisies: NormalizedArtikel[]` voor geneste niveaus. `processNode` daalt
  recursief af, zodat elk niveau (ook ≥3 diep) een eigen node met volledig sectiepad én tekst krijgt
  — geen platslaan, geen tekstverlies. Dit raakt de Leidraad Invordering 2008 (792 geneste divisies).
- `renderTableToMarkdown` legt cellen in een raster dat `colspan`/`rowspan` respecteert (elke rij
  exact `cols` kolommen), escapet `|` in celtekst, fabriceert bij ontbrekende `<thead>` géén
  dubbele rij, en scheidt meerdere `<al>` in één cel. Inline refs zonder target renderen als
  platte label (geen `[x](undefined)`).

### `wettenbank_zoekterm` — wildcards and operators

`bouwTermPatroon(zoekterm)` converts a search term to a regex pattern:

| Input | Regex | Matches |
|-------|-------|---------|
| `termijn` | `\btermijn\b` | exact word only |
| `termijn*` | `\btermijn\w*` | `termijn`, `termijnen`, `termijnoverschrijding` |
| `*termijn` | `\w*termijn\b` | `termijn`, `betalingstermijn` |
| `*termijn*` | `\w*termijn\w*` | anything containing `termijn` |

`parseZoekterm(zoekterm)` detecteert operatoren **case-insensitief en op woordgrenzen**
(`EN`/`AND` → EN, `OF`/`OR` → OF; dus ook lowercase `en`/`of`, en `ENERGIE` telt niet als
operator), splitst, en bouwt per deelterm een patroon via **`bouwTermPatroon`** (één bron van
waarheid — het testpad = het productiepad). Lege deeltermen en bare `*` worden geweigerd.
Resultaat: `ZoekInput { patronen: RegExp[], operator: "EN"|"OF" }`. With EN, only articles where all patterns occur are returned. Patterns carry the `gi` flags; `pat.lastIndex` is explicitly reset to `0` before every `.match()` / `.test()` call to prevent stateful drift when the same instance is reused across articles.

Special characters are pre-escaped via `escapeerRegex()`. Treffer-aantallen kennen géén
kunstmatige cap; `totaalTreffers` is exact.

### XML schemas as design basis

Two public schemas from `repository.officiele-overheidspublicaties.nl` are the silent blueprint behind the parsing logic:

**`BWB-toestand/2016-1`** — structural container types used in `zoekElementInDom` and `bouwStructuurNodes`: `boek`, `deel`, `hoofdstuk`, `afdeling`, `paragraaf`, `wettekst`, `wetgeving`, `circulaire`, `circulaire-tekst`. Note `circulaire-tekst`: the Leidraad has `circulaire → circulaire-tekst → circulaire.divisie[]`; without this level, all Leidraad articles would not be found. Field names parsed by `bwb-parser`: `kop`, `nr`, `al`, `lid`, `lidnr`, `lijst`, `li`, `tekst`.

**`BWB-WTI/2016-1`** — record structure returned by the SRU service. Path names in `parseRecords()` are WTI-XSD elements and namespaces: `gzd → originalData → overheidbwb:meta → owmskern (dcterms:*, overheid:*)` and `enrichedData → overheidbwb:locatie_toestand`.

**Communication:** twee transports, gekozen in `dist/index.js` op basis van `MCP_TRANSPORT` (env) of `--transport <modus>` (CLI-flag); default is `stdio`.

- **stdio** (default) — de client start de server als subproces en wisselt JSON uit over stdin/stdout via `StdioServerTransport`. Gebruikt de singleton `server` uit `server.ts`.
- **http** (`MCP_TRANSPORT=http`) — langlevende netwerkservice via `StreamableHTTPServerTransport` op `0.0.0.0:${PORT:-3000}`, endpoint `/mcp`. Code in `http-server.ts` (Node-stdlib `http`, geen extra dependency): sessiebeheer per `mcp-session-id` met **idle-opruiming** van verlaten sessies (`MCP_SESSION_IDLE_MS`, default 30 min) — sessies met een **open SSE-stream of lopend request worden ontzien** (een per-sessie in-flight teller), omdat `transport.close()` álle streams hard afbreekt; een verse `createServer()`-instantie per sessie, `/health` (200, geen auth; geeft `status` + build-info `version`/`commit`/`builtAt` uit `build-info.ts`), `/ready` (readiness: pingt de upstream-hosts kort, ~15s gecachet; 503 als SRU of repository onbereikbaar is — i.t.t. `/health` dat puur liveness is) en bearer-auth via `MCP_AUTH_TOKEN` (constant-tijd vergelijking). In HTTP-modus is de start **fail-closed**: zonder `MCP_AUTH_TOKEN` weigert `index.ts` te starten, tenzij `MCP_ALLOW_NO_AUTH=1`. Bedoeld voor de gecontaineriseerde deployment.

Entry point is `dist/index.js` (re-exports + startup); de serverlogica zit in `dist/server.js`, het HTTP-transport in `dist/http-server.js`.

## Logging & beveiliging (HTTP-modus / enterprise)

Voor de gecontaineriseerde HTTP-deployment is een logging- en hardeningslaag toegevoegd,
afgestemd op BIO2 / NEN-EN-ISO/IEC 27002:2022. Zie `SECURITY.md` voor het volledige overzicht
(env-vars, logvelden, bewaartermijn, SIEM).

- **Logging** (`src/logger.ts`): gestructureerde JSON, één regel per event naar **stderr**
  (geen eigen logbestanden; de runtime/SIEM vangt stderr op). Categorieën `functioneel` |
  `audit` | `security`. `server.ts` logt per tool-aanroep een **audit**-regel met `clientId`,
  `sessionId`, tool en BWB-id/artikel. **Tokens en rauwe zoektermen worden nooit gelogd**
  (AVG-dataminimalisatie); zet `LOG_ZOEKTERMEN=1` alleen voor debug. `LOG_LEVEL` (`debug|info|warn|error`,
  default `info`) stelt de drempel in. **Foutdiagnose:** een gefaalde tool-call logt naast `fout`
  ook `fout_code` (de onderliggende undici/TLS-`code`, bv. `UNABLE_TO_VERIFY_LEAF_SIGNATURE`),
  `fout_klasse` (`transient|permanent|client|onbekend`), `bron` en `upstream_host`/`upstream_status`
  (host zonder query — geen zoekterm-lek). **Permanente** fouten (TLS/4xx) loggen op `error`, de rest
  op `warn`, zodat SIEM-alerting op `error` zinvol is. Het foutmodel staat in `src/shared/fouten.ts`
  (`UpstreamError` + `foutDetails`).
- **Auth** (`src/auth.ts`): **per-client bearer-tokens** via `MCP_AUTH_TOKENS="id:token,id2:token2"`
  (constant-tijd vergeleken), met de legacy `MCP_AUTH_TOKEN` als fallback (clientId `default`;
  een kale token zonder `id:`-prefix logt een security-warn). Tokens mogen ook uit een bestand
  komen (`MCP_AUTH_TOKENS_FILE`, voor Docker secrets/vault — aanbevolen boven stack-env).
  Optioneel **OIDC** (`src/oidc.ts`, dormant tenzij `OIDC_ISSUER` gezet): JWT-bearer-validatie via
  JWKS; `OIDC_AUDIENCE` is dan **verplicht** (anders token-confusion) en het JWKS-endpoint komt
  uit OIDC-discovery (`.well-known/openid-configuration` → `jwks_uri`) of expliciet
  `OIDC_JWKS_URI`. In HTTP-modus is de start fail-closed: zonder enige auth weigert `index.ts`
  te starten, tenzij `MCP_ALLOW_NO_AUTH=1` — en `startHttpServer` zelf throwt eveneens zonder
  auth tenzij `allowNoAuth: true`. **Sessies zijn gebonden aan de initialiserende clientId**:
  een ander token met hetzelfde sessie-ID krijgt 404. Optionele `MCP_ALLOWED_HOSTS` weigert
  vreemde `Host`-headers op `/mcp` (DNS-rebinding). `/health` toont build-info alleen mét token.
- **Rate limiting** (`src/rate-limit.ts`): token-bucket per IP (IPv6 per /64-prefix, hard plafond
  op het aantal emmers). `MCP_RATE_BURST` (default 60) en `MCP_RATE_PER_MIN` (default 120); over
  de limiet → `429`. Ná auth volgt een tweede, ruimere limiter per `clientId`
  (`MCP_RATE_CLIENT_BURST`/`MCP_RATE_CLIENT_PER_MIN`, defaults 120/300). Het client-IP komt uit
  `X-Forwarded-For` via de N-de waarde van rechts (`MCP_TRUSTED_PROXY_HOPS`, default 1), zodat een
  zelf meegestuurde XFF de limiet niet omzeilt — de reverse-proxy (NPM) moet XFF dus **zetten**.
- **Securityheaders**: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cache-Control: no-store`
  op elke respons. `/health` blijft auth-vrij en wordt niet gelogd.
- **CI** (`.github/workflows/docker-publish.yml`): aparte `test`-job met `npm test` + `npm audit`
  (faalt bij high/critical), Trivy image-scan (SARIF → Security-tab, faalt bij CRITICAL), en
  SBOM/provenance-attestatie bij de image. Dependabot in `.github/dependabot.yml`.
- **GHCR-retentie** (`.github/workflows/ghcr-cleanup.yml`): bewaart structureel de **5 nieuwste
  builds** (getagde versies) + hun attestatie-child-manifests; draait automatisch ná een
  geslaagde `docker-publish` (`workflow_run`). Handmatig (`workflow_dispatch`) staat het standaard
  in **dry-run** — zet input `dry_run=false` voor een echte opschoning. Verwijderen verloopt via
  `dataaxiom/ghcr-cleanup-action` omdat die de multi-arch/attestatie-graaf respecteert.

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
- `docker-compose.yml` — Portainer-stack achter Nginx Proxy Manager: géén host-poort, container op het gedeelde NPM-netwerk (`PROXY_NETWORK`), NPM proxyt `wettenbank-mcp.ipalm.nl` → `wettenbank-mcp:3000` met TLS. Tokens via `MCP_AUTH_TOKENS` (stack-env) of liever `MCP_AUTH_TOKENS_FILE` (gemount bestand); runtime-hardening (`read_only`, `cap_drop: ALL`, `no-new-privileges`, mem/pids-limieten). CI deployt **op digest** via de stack-var `WETTENBANK_IMAGE` (default `:latest` voor handmatige deploys).
- `.github/workflows/docker-publish.yml` — bouwt en pusht `ghcr.io/<owner>/wettenbank-mcp` (CI is de build-route; lokaal hoeft geen Docker-engine aanwezig te zijn).
- `HANDLEIDING-IMAGE.md` — beknopte stap-voor-stap voor **externe gebruikers** die alleen het publieke image willen draaien (placeholders i.p.v. deze deployment-namen). Verwijs hiernaar bij vragen "hoe draait iemand anders dit?".

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
