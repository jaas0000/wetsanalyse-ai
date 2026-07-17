# Wettenbank-MCP

MCP-server (TypeScript/ESM) die **vanuit Claude Code actuele Nederlandse wetgeving** ophaalt via de
publieke SRU-interface van `wetten.overheid.nl`. Geen API-sleutel nodig — alle data is CC-0. Dit is
de **databron** van het Wetsanalyse-project; de skill en de API roepen 'm intern aan.

> **Diepe architectuur** (bwb-parser-pipeline, module-voor-module, gegevensmodel, XML-schema's als
> ontwerpbasis, foutmodel) staat in **[`CLAUDE.md`](CLAUDE.md)** — die is de bron van waarheid voor
> werk *in* de server. Beveiliging/hardening in **[`SECURITY.md`](SECURITY.md)**; alleen het
> publieke image draaien in **[`HANDLEIDING-IMAGE.md`](HANDLEIDING-IMAGE.md)**.

## Tools

| Tool | Doel |
|------|------|
| `wettenbank_zoek` | Regelingen zoeken op titel, rechtsgebied, ministerie of regelingsoort — JSON met een `regelingen`-array. |
| `wettenbank_structuur` | Inhoudsopgave van een wet (hoofdstukken/afdelingen/paragrafen + artikelnummers), zonder artikeltekst. |
| `wettenbank_artikel` | Eén artikel via BWB-id + artikelnummer — `leden` (met per lid de getagde `verwijzingen`), `pad`, `bronreferentie`, `formaat`. |
| `wettenbank_zoekterm` | Full-text zoeken binnen een wet — wildcards + EN/OF-operatoren; optioneel de artikeltekst meesturen. |

Alle tools geven **pure JSON** terug (als string in het MCP-`text`-blok) met een `formaat`-veld
(`plain`/`markdown`). Aanbevolen volgorde:

```
wettenbank_zoek       → BWB-id achterhalen
wettenbank_structuur  → inhoudsopgave, juist artikelnummer bepalen
wettenbank_artikel    → specifiek artikel ophalen
```

Of in één stap voor full-text: `wettenbank_zoekterm` met `includeerTekst=true`.

## Configuratie

De server kent twee draaiwijzen: **remote (HTTP)** als gedeelde gecontaineriseerde service, of
**lokaal (stdio)** als subproces.

**Remote — HTTP (standaard in dit project).** Het token komt via env-expansie, zodat het niet in de
repo belandt:

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

**Lokaal — stdio (Claude Code CLI).** Projectrelatief pad houdt de map portabel:

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

Voor Claude Desktop hetzelfde blok in `claude_desktop_config.json`, met een absoluut pad naar
`dist/index.js`. Na een configwijziging Claude Code/Desktop herstarten; controleer met
`claude mcp list` (verwacht `wettenbank → ✓ Connected`).

## Bekende BWB-ids

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

> **Let op:** `BWBR0004800` is de *Leidraad invordering 1990* (verlopen per 2005-07-12) — niet gebruiken.

## Bouwen, draaien, testen

Vereist Node.js ≥ 18 (ESM) + npm.

| Commando | Doel |
|----------|------|
| `npm install` | Dependencies |
| `npm run build` | TypeScript → `dist/` (gecommit; nodig om te draaien) |
| `npm test` | Unit-tests (Vitest, eenmalig) — draai vóór een commit |
| `npm run test:watch` | Tests in watch-modus |
| `npm run dev` | Direct draaien met `tsx` (zonder build) |
| `npm start` | Gecompileerde server: `node dist/index.js` |

CI bevat een **dist-staleness-check**: bouw en commit `dist/` mee.

## Observability

In HTTP-modus is de server **geïnstrumenteerd** (JSON-stderr-logs met trace-velden + OpenTelemetry
traces/metrics), gated op `OTEL_EXPORTER_OTLP_ENDPOINT` — leeg = alleen logs. Custom metric:
cache hit/miss (`wettenbank.cache.toegang`). Zie de projectbrede
[`../../docs/observability.md`](../../docs/observability.md).

## Deployment (remote HTTP)

Voor de gedeelde HTTP-service: een multi-stage, non-root **`Dockerfile`** (`HEALTHCHECK` op `/health`,
default `MCP_TRANSPORT=http`) + **`docker-compose.yml`** als Portainer-stack achter Nginx Proxy
Manager (géén host-poort; NPM proxyt `wettenbank-mcp.ipalm.nl` → `wettenbank-mcp:3000` met TLS). CI
(`.github/workflows/docker-publish.yml`) bouwt en pusht `ghcr.io/palmw01/wettenbank-mcp`. De start is
**fail-closed**: zonder geconfigureerde auth weigert de server te starten (tenzij
`MCP_ALLOW_NO_AUTH=1`). De volledige env-vars (auth, OIDC, rate limiting, logging) + hardening staan
in [`SECURITY.md`](SECURITY.md); de deploymentdetails in [`CLAUDE.md`](CLAUDE.md).
