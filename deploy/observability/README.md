# Observability-backends (optioneel) — voor je bestaande Grafana

Een **optionele** stack die de OTLP-ingest-backends levert die je nog mist, om de instrumentatie van
API/frontend/MCP zichtbaar te maken in je **bestaande** Grafana (`unpoller-grafana`). Deze stack bevat
**geen eigen Grafana** — je hebt er al één.

```
API / frontend / MCP  ──OTLP──►  otel-collector ──►  Tempo   (traces)
                                                 ├─►  Loki    (logs)
                                                 └─►  Prometheus (metrics)
                                                          ▲
                              bestaande unpoller-grafana ─┘ (3 datasources)
```

Componenten (alle op `homeinfra_internal`, geen host-poorten, geen NPM-route — intern zoals Postgres):
- **otel-collector** (`otel/opentelemetry-collector-contrib`) — ontvangt OTLP op 4317/4318. Leidt met
  de **`spanmetrics`- en `servicegraph`-connectors** ook RED-metrics per service én topologie-edges
  (`traces_service_graph_request_total`) uit de traces af; die voeden het Node Graph-panel en de
  live systeemtopologie.
- **tempo** — traces, query op `http://tempo:3200`.
- **loki** — logs, query op `http://loki:3100`.
- **prometheus** — metrics, query op `http://prometheus:9090` (scrapet de collector op `:8889`).

> Homelab-schaal (lokale opslag, korte retentie: traces 48u, logs 7d, metrics 15d). Pas de retentie
> in `tempo.yaml` / `loki-config.yaml` / de prometheus-`command` aan naar smaak. Voor productie de
> componenten schalen/splitsen (object storage i.p.v. filesystem).

## 1. Deployen (Portainer)

Deploy als Portainer-stack (git of upload). De config-bestanden (`otel-collector-config.yaml`,
`tempo.yaml`, `loki-config.yaml`, `prometheus.yml`) worden als volume gemount — houd ze naast de
compose. Enige stack-env: `PROXY_NETWORK` (default `homeinfra_internal`).

## 2. De app-stacks laten exporteren

Zet in elke app-stack (`wetsanalyse-api`, `wetsanalyse-frontend`, `wettenbank-mcp`) de stack-env en
**herstart** de container (OTel initialiseert bij processtart):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

De API-image bevat de `otel`-extra al (default in `api/Dockerfile`); `OTEL_SERVICE_NAME` staat per app
al goed.

## 3. Datasources toevoegen aan je bestaande Grafana

Twee manieren (zie `grafana-datasources.yaml` voor de exacte waarden):

- **A — via de UI (aanbevolen, niets aan de unpoller-stack wijzigen):** Grafana →
  *Connections → Data sources → Add*, en voeg toe:
  - Prometheus → `http://prometheus:9090`
  - Loki → `http://loki:3100`
  - Tempo → `http://tempo:3200`
- **B — via provisioning:** mount `grafana-datasources.yaml` in de `unpoller-grafana`-container onder
  `/etc/grafana/provisioning/datasources/wetsanalyse.yaml` en herstart Grafana. Vereist een kleine
  aanpassing aan de unpoller-stack (extra volume-mount).

## 4. Verifiëren

Draai een analyse en een chat in de webapp, dan in Grafana → **Explore**:
- **Tempo**: één trace `frontend → API → MCP` (gedeelde `trace_id`) en de `chat.n8n`-span.
- **Loki**: de gecorreleerde logregels (filter op `trace_id`); via de derived field spring je door naar
  de trace in Tempo.
- **Prometheus**: `wetsanalyse_fase_duur_ms_milliseconds_*` (histogram; de OTLP→Prometheus-export
  plakt de unit-suffix erachter), `wetsanalyse_fase_fouten_total`, `wetsanalyse_llm_tokens_total`,
  `wettenbank_cache_toegang_total` (label `resultaat=hit|miss`) en de auto-http-metrics
  (`http_server_duration_milliseconds_*`). Services onderscheiden via label `exported_job`.
  Uit de connectors: `traces_service_graph_request_total` (labels `client`/`server`/`connection_type`)
  en `traces_spanmetrics_calls_total`/`_duration_*` (labels `service_name`/`span_name`). Let op: de
  `http_client_*`-metric draagt **geen host/target-label**, dus per-bestemming-edges (frontend →
  API, MCP → overheid.nl, API → Postgres) komen uit de service-graph, niet uit `http_client`.

## Aandachtspunten

- **Volume-rechten:** tempo en loki draaien met `user: "0:0"` zodat ze naar hun named volume kunnen
  schrijven (named volumes worden als root aangemaakt). Internal-only containers zonder host-mounts →
  laag risico; hard je desgewenst later met een pre-chown-init.
- **Loki OTLP:** vereist `allow_structured_metadata: true` (staat aan in `loki-config.yaml`) en Loki 3.x.
- **Geen auth op de backends:** ze zijn alleen intern bereikbaar op `homeinfra_internal`. Zet ze niet
  achter NPM/host-poorten.

## 5. Dashboards importeren

Er zijn **twee** kant-en-klare dashboards (map "Wetsanalyse"):

- `grafana-dashboard-wetsanalyse.json` — *"Wetsanalyse — observability"* (trends: engine-fase-duur/
  -fouten, LLM-tokens, MCP-cache, HTTP, logs, traces).
- `grafana-dashboard-topologie.json` — *"Wetsanalyse — systeemtopologie"*: de **live keten die
  oplicht** (Canvas: frontend → API → MCP/LLM/Postgres → overheid.nl, en API → n8n → GraphDB), de
  **automatische Node Graph** (uit de service-graph), een **trace-waterfall + logs** om één executie
  te volgen, en de **live analyses-tabel** die het opgeheven frontend-`/dashboard` vervangt.

Importeren:

- **UI:** Grafana → *Dashboards → New → Import* → upload het JSON-bestand → map "Wetsanalyse".
- **API/CI:** `provision-grafana.sh` importeert **beide** dashboards (idempotent), of
  `POST /api/dashboards/db` met body `{"dashboard": <inhoud>, "folderUid": "wetsanalyse",
  "overwrite": true}`.

Vereist de datasource-uid's **`wa-prometheus`**, **`wa-loki`**, **`wa-tempo`** (zoals in
`grafana-datasources.yaml`) en een map met uid `wetsanalyse`. Het systeemtopologie-dashboard gebruikt
daarnaast **`wa-postgres`** voor de live analyses-tabel (zie sectie 9); zonder die datasource werken
alle andere panels gewoon, alleen de jobs-tabel/tellers blijven leeg.

> **Systeemtopologie afronden.** De Canvas is bewust een startpunt: doorloopt/lichthoogte fijn je het
> makkelijkst interactief bij (*Edit → Canvas*). De node-queries voor frontend/Postgres/n8n/overheid.nl
> leunen op de service-graph-metrics — draai eerst een analyse + chat zodat de connectors data hebben,
> en verifieer dan de labelwaarden (`client`/`server`) in *Explore* voordat je ze vastzet.

## 9. Live analyses-tabel (read-only jobstore-datasource)

Het systeemtopologie-dashboard toont een live tabel van alle analyses (state, fijnmazige fase,
tijd-in-fase, tokens, fout) rechtstreeks uit de PostgreSQL-jobstore — de vervanger van het opgeheven
frontend-`/dashboard`. Eenmalige inrichting:

1. **Read-only rol + view** (`deploy/postgres/grafana-readonly.sql`): maakt de rol `grafana_ro` en de
   smalle view `dashboard_jobs`. Grafana krijgt **alleen** SELECT op die view — nooit op `projects`
   zelf, `users`, `api_tokens` of LLM-keys. Draai het script eenmalig als DB-owner (zie de kop van het
   SQL-bestand voor het exacte `docker exec … psql`-commando en het wachtwoord-secret).
2. **Datasource** `wa-postgres` (in `grafana-datasources.yaml` én `provision-grafana.sh`): verbindt als
   `grafana_ro`. Het wachtwoord komt uit de env-var **`GRAFANA_WA_PG_PASSWORD`** op de Grafana-container
   (bij provisioning: het gelijknamige host-secret) — niet uit de repo. Ontbreekt de env-var, dan slaat
   `provision-grafana.sh` deze datasource over.

> De tabel is **cross-client** (toont álle analyses van alle clients) — bewust, want Grafana staat
> achter admin-toegang. De interactieve review/retry-acties blijven in de webapp; Grafana is read-only.

## 6. Frontend/MCP-logs naar Loki (Alloy)

De **API** logt via OTLP naar Loki. De **frontend** en **MCP** loggen naar stdout/stderr; de
`alloy`-service (in de compose) scrapet die container-logs en pusht ze naar Loki
(`alloy-config.alloy`). De config filtert bewust op `wetsanalyse-frontend` + `wettenbank-mcp` (de API
niet — die komt al via OTLP, dus geen dubbeling), zet `service_name` op de containernaam, promoveert
`niveau` → label `detected_level` en `trace_id`/`categorie` → structured metadata.

- **Docker-socket:** alloy mount `/var/run/docker.sock` **read-only** (alleen containerlogs lezen).
- Verifiëren: Grafana → Explore → Loki → `{service_name="wettenbank-mcp"}` en
  `{service_name="wetsanalyse-frontend"}` geven logregels.

## 7. Alerting (→ n8n-webhook)

`alerting/` bevat de definities (reproduceerbaar; de live-bron is de Grafana-provisioning-API):
- `contact-point.json` — webhook-contactpunt `wetsanalyse-n8n` (**pas de `url` aan naar je eigen
  n8n-webhook**).
- `alert-rules.json` — 4 regels in groep `wetsanalyse-1m` (map "Wetsanalyse"): fase-fouten, HTTP 5xx,
  latency p95 > 5s, telemetrie-backend down (`up{job="otel-collector"}==0`). Elke regel routeert via
  `notification_settings` rechtstreeks naar het contactpunt (raakt je globale notificatie-policies niet).
- `apply.sh` — idempotent toepassen:
  `GRAFANA_URL=https://grafana.ipalm.nl GRAFANA_TOKEN=<sa-token> ./apply.sh`.

## 8. Reproduceerbare deploy (CI, één dispatch)

De hele observability-laag staat in één keer neer via **`.github/workflows/deploy-observability.yml`**
(`workflow_dispatch`, of automatisch bij een push op `deploy/observability/**`):

1. **Backends-stack** → Portainer (`docker-compose.stack.yml`, de self-contained variant met inline
   `configs:` — géén host-bestanden nodig). Idempotente PUT + wachten tot de 5 containers draaien.
2. **Grafana provisionen** → `provision-grafana.sh` (idempotent: de 3 datasources + de map + het
   dashboard `grafana-dashboard-wetsanalyse.json`).
3. **Alerting** → `alerting/apply.sh` (contactpunt + 4 regels).

Benodigde secrets/vars: `PORTAINER_URL`/`PORTAINER_API_KEY`/`vars.PORTAINER_OBSERVABILITY_STACK_ID`,
`GRAFANA_URL`/`GRAFANA_TOKEN`. Losse componenten draai je ook handmatig
(`provision-grafana.sh`, `alerting/apply.sh`).

> `docker-compose.stack.yml` is de **gedeployde** variant (inline configs, incl. Alloy); de
> `docker-compose.yml` hiernaast is de bindmount-variant voor lokaal/handmatig. Houd ze equivalent.
> De n8n-alert-webhook (ontvanger) leeft in n8n, buiten deze repo.
