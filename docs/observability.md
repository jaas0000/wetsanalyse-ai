# Observability — logging, traces & metrics

Dit project is **geïnstrumenteerd, niet bemeterd**: elke component emitteert gestructureerde logs én
kan OpenTelemetry (traces/metrics/logs) naar een **configureerbaar OTLP-endpoint** sturen. Een
**optionele verzamelstack** (OTel-Collector + Tempo + Loki + Prometheus, plus Alloy voor de
stdout-logs, mét dashboard en alerting) staat kant-en-klaar in **`deploy/observability/`** — géén eigen
Grafana; die koppel je aan je bestaande. Je zet 'm aan via één env-var. Zonder endpoint draait alles
ongewijzigd met alléén gestructureerde JSON-logging (nul overhead, geen gedragsverandering).

## Wat is geïnstrumenteerd

| Component | Logging | Traces | Metrics |
|-----------|---------|--------|---------|
| **API** (`api/`, FastAPI) | JSON-`dictConfig`, request-id-middleware, access-log | FastAPI-requests, httpx (MCP+n8n), DB, per-fase job-spans | fase-duur, fase-fouten per klasse, LLM-tokens |
| **Frontend** (`frontend/`, Next.js) | server-side JSON naar stdout in de BFF-lagen | `@vercel/otel`: route handlers + uitgaande `fetch` (traceparent) | request-count/latency (auto) |
| **MCP** (`tools/wettenbank-mcp/`) | bestaande JSON-stderr-logger, nu met trace-velden | `/mcp`-requests (http) + SRU/repository-fetches (undici) | http-server-latency, upstream-fetch-duur, cache hit/miss |
| **Chatbot-hop** | API `/v1/chat` + BFF-route (geen inhoud/secret) | span `chat.n8n` + traceparent naar n8n | — |

De **n8n-workflow en de GraphDB-kennisgraaf draaien buiten deze repo** en zijn niet
geïnstrumenteerd. Voor een trace die dóórloopt tot in de agent moet de n8n-workflow zelf
OTel-instrumentatie krijgen (follow-up).

## Correlatie

Eén **trace-id** verbindt de keten: `frontend → API → MCP` (wettekst ophalen) en
`frontend → API → n8n` (chat). OTel propageert automatisch via de W3C-`traceparent`-header op
uitgaande `fetch`/httpx-calls. Elke logregel draagt `trace_id`/`span_id` zodra er een span actief is,
plus (in de API) een `request_id` per inkomend verzoek (`X-Request-Id`, gegenereerd of overgenomen en
in de response geëchood).

## Logschema

Alle drie de loggers delen dezelfde vorm (bron: `tools/wettenbank-mcp/src/logger.ts`):

```json
{"ts":"2026-07-16T14:37:23.698Z","niveau":"info","categorie":"functioneel",
 "bericht":"...","trace_id":"…","span_id":"…","<vrije velden>":"…"}
```

- `niveau`: `debug|info|warn|error` (drempel via `LOG_LEVEL`).
- `categorie`: `functioneel` (verkeer) · `audit` (wie deed wat) · `security` (auth/abuse).
- **AVG/dataminimalisatie**: tokens, secrets en verzoek-/antwoordinhoud (chatInput, prompts) worden
  **nooit** gelogd — alleen metadata (status, duur, lengtes, ids, paden). Geheime veldnamen worden
  defensief geredacteerd.

## Aanzetten

Zet in elke stack (of `.env`) het endpoint van je OTel-Collector; laat 'm leeg om OTel uit te houden.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # leeg = uit (alleen JSON-logs)
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf                # API/MCP; frontend gebruikt @vercel/otel
OTEL_SERVICE_NAME=wetsanalyse-api                        # per component (zie compose-defaults)
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=productie
LOG_LEVEL=info
LOG_FORMAT=json                                          # API: 'text' is prettiger lokaal
```

De env-vars staan al in de drie `docker-compose.yml`'s, de `.env.example`'s en (voor Azure) in
`main.bicep` (param `otelEndpoint`). In de **API-image** is de `otel`-extra meegebouwd
(`uv sync --extra otel`); lokaal draai je met `uv sync --extra otel`.

> **Let op bij Portainer + CI-deploy:** een stack-update via de Portainer-API **vervangt** de
> volledige stack-env door wat de deploy-payload meestuurt — een handmatig in Portainer gezette
> `OTEL_EXPORTER_OTLP_ENDPOINT` overleeft de eerstvolgende redeploy dus niet. Daarom geven de drie
> publish-workflows (`api`/`frontend`/`docker`-`-publish.yml`) het endpoint expliciet mee in de
> `jq`-payload, default `http://otel-collector:4318` (override via repo-var
> `vars.OTEL_EXPORTER_OTLP_ENDPOINT`). Laat die regel staan — zonder het endpoint valt de
> compose-default terug op leeg en zet een deploy de hele observability stil (alleen de
> Alloy→Loki-stdout-logs blijven dan nog lopen).

## Grafana koppelen

Er is **geen app-wijziging** nodig — de instrumentatie stuurt standaard-OTLP; Grafana koppelen is
puur een ops-stap. Twee gangbare paden:

### a) Grafana Cloud (managed)

Grafana Cloud heeft een eigen OTLP-gateway — geen eigen collector nodig. Zet per service:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceID:token)>
```

Traces → Tempo, logs → Loki, metrics → Prometheus/Mimir landen dan in je Grafana-Cloud-stack.
(De frontend gebruikt `@vercel/otel`, dat dezelfde OTEL_*-env-vars leest.)

### b) Self-hosted (homelab/Portainer) — koppelen aan een bestaande Grafana

Er staat een **kant-en-klare optionele backends-stack** in
[`../deploy/observability/`](../deploy/observability/): **OTel-Collector + Tempo + Loki +
Prometheus** (géén eigen Grafana — die koppel je aan je bestaande) op het gedeelde
`homeinfra_internal`-netwerk. De collector ontvangt OTLP op 4317/4318 (intern) en routeert traces →
Tempo, logs → Loki, metrics → Prometheus. Wijs daarna elke app-stack naar
`http://otel-collector:4318` en voeg Tempo/Loki/Prometheus als datasources toe aan je bestaande
Grafana. Volledige stappen: [`deploy/observability/README.md`](../deploy/observability/README.md).

De stack bevat bovendien:

- **Alloy** — scrapet de container-stdout van **frontend + MCP** (die niet via OTLP loggen) en pusht
  die naar Loki (`service_name` = containernaam, `niveau` → label `detected_level`, `trace_id`/
  `categorie` als structured metadata). De API blijft via OTLP loggen, dus geen dubbeling.
  Read-only `docker.sock`-mount. Config: `alloy-config.alloy`.
- **Dashboard** — `grafana-dashboard-wetsanalyse.json` (engine-fase-duur/-fouten, LLM-tokens,
  MCP-cache, HTTP-verkeer, logs, traces). Importeren via de UI of `POST /api/dashboards/db`.
- **Alerting** — `alerting/` (contactpunt + regels: fase-fouten, HTTP 5xx, latency p95, backend down;
  routeren naar een webhook, bv. n8n) met een idempotent `apply.sh`.

Wie liever een all-in-één demo-image draait (inclusief Grafana) kan `grafana/otel-lgtm` gebruiken;
deze repo mikt op koppeling aan een bestaande Grafana.

Lokaal snel proberen: draai een collector met een debug-exporter (bijv. `otel-tui` of `otelcol` met
de `debug`-exporter) op `localhost:4318` en zet het endpoint op alle vier de componenten.

## Waarom het endpoint env-config is (en niet in /beheer)

Het OTLP-endpoint is **boot-tijd-infraconfiguratie** via env/compose, niet iets uit het
`/beheer`-scherm. Reden: OpenTelemetry initialiseert **één keer bij processtart** en de
SDK-providers/exporters zijn *set-once* — ze kunnen niet live herpoint worden. Bovendien draaien de
drie services in **aparte containers** met hun eigen env (niet de API-database waar `/beheer` naar
schrijft). Een `/beheer`-veld zou dus alleen de API raken én pas ná herstart werken; env houden is
eerlijker en eenduidiger.

## Verifiëren

- **No-op-gating**: start zonder endpoint → alles draait, alleen JSON-logs.
- **Trace-correlatie**: maak een analyse aan via de frontend → één trace omspant frontend → API →
  MCP; job-spans per orchestrator-stap. De chatbel → frontend → API → n8n-POST.
- **Geen lek**: `grep` de logoutput op `bearer`/`secret`/de chat-`secret`-waarde → leeg.

### Metric- en labelnamen (zoals ze in Prometheus/Loki landen)

De OTLP→Prometheus-export voegt unit-/type-suffixen toe; onthoud dit bij het bouwen van queries:

- `wetsanalyse_fase_duur_ms_milliseconds_{bucket,count,sum}` — histogram, label **`stap`**.
- `wetsanalyse_llm_tokens_total`, `wetsanalyse_fase_fouten_total` (labels `stap`, `klasse`) — counters.
- `wettenbank_cache_toegang_total` — counter, label **`resultaat`** (`hit`/`miss`).
- Auto-HTTP: `http_server_duration_milliseconds_*` (labels `http_method`/`http_status_code`/`http_target`).
- Services onderscheiden via het label **`exported_job`** (`wetsanalyse-api`/`wettenbank-mcp`/…).
- **Loki**: de OTLP-logs dragen de velden als **structured metadata** (`detected_level`, `trace_id`,
  `categorie`), niet als JSON in de regel — filter dus op die labels, niet met `| json`. De
  Loki-datasource heeft een derived field `trace_id` → Tempo voor de doorklik.
