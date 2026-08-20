# Observability-stack

Maakt de instrumentatie van api/frontend/graph-qa zichtbaar: OTLP-ingest, opslag en **Grafana**.
Draait op de docker-host (stack `observability`).

```
api / frontend / graph-qa  ──OTLP──►  otel-collector ──►  Tempo   (traces)
                                                      ├─►  Loki    (logs)
                                                      └─►  Prometheus (metrics)
                                                               ▲
                                                     Grafana ──┘ (3 datasources)
                                              grafana.example
docker-logs ──► Alloy ──► Loki
```

Componenten (alle op `observability_default`; alleen Grafana publiceert een hostpoort, omdat NPM op
een andere host draait en geen docker-netwerk deelt):
- **otel-collector** (`otel/opentelemetry-collector-contrib`) — ontvangt OTLP op 4317/4318. Leidt met
  de **`spanmetrics`- en `servicegraph`-connectors** ook RED-metrics per service én topologie-edges
  (`traces_service_graph_request_total`) uit de traces af; die voeden het Node Graph-panel en de
  live systeemtopologie.
- **tempo** — traces, query op `http://tempo:3200`.
- **loki** — logs, query op `http://loki:3100`.
- **prometheus** — metrics, query op `http://prometheus:9090` (scrapet de collector op `:8889`).
- **alloy** — leest de docker-logs van `wetsanalyse-dev-*`, `graphdb`, `bwb-import` en
  `mcp-auth-proxy` en shipt ze naar Loki (JSON-parse → `detected_level`, `trace_id`, `categorie`).
- **grafana** — UI op poort 3001 (host) → `https://grafana.example` via nginx-proxy-manager. De drie
  datasources komen als **file-provisioning** uit de compose en zijn daardoor in de UI read-only. Dat
  is de bedoeling: de definitie hoort in de stack, niet in de database van Grafana.

> Homelab-schaal (lokale opslag, korte retentie: traces 48u, logs 7d, metrics 15d). Pas de retentie
> in `tempo.yaml` / `loki-config.yaml` / de prometheus-`command` aan naar smaak. Voor productie de
> componenten schalen/splitsen (object storage i.p.v. filesystem).

## 1. Deployen

Via `.github/workflows/deploy-observability.yml` (handmatig of bij wijzigingen in
`deploy/observability/**`). Die stuurt `docker-compose.stack.yml` als string naar de Portainer-API;
de configs zitten **inline** in de compose, dus er hoeft niets gemount te worden.

Stack-env: `OBS_NETWORK` (default `observability_default`), `GRAFANA_ADMIN_PASSWORD` (verplicht,
`secrets.GRAFANA_ADMIN_PASSWORD`) en `GRAFANA_ROOT_URL` (default `https://grafana.example`).

Het netwerk wordt door **deze** stack aangemaakt; de dev-stack joint er als extern netwerk op. Deploy
observability dus vóór een dev-deploy, anders faalt die op een ontbrekend netwerk.

## 2. De app-stacks laten exporteren

Zet in elke app-stack (`wetsanalyse-api`, `wetsanalyse-frontend`) de stack-env en
**herstart** de container (OTel initialiseert bij processtart):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

De API-image bevat de `otel`-extra al (default in `api/Dockerfile`); `OTEL_SERVICE_NAME` staat per app
al goed.

## 3. Datasources

Die zijn er al: de compose provisioneert `wa-prometheus`, `wa-loki` en `wa-tempo` mee, inclusief de
correlaties (van een logregel naar de trace via `trace_id`, van een span naar de logs, en de nodeGraph
uit de servicegraph-metrics). Omdat het **file-provisioning** is, zijn ze in de UI read-only —
aanpassen doe je in `docker-compose.stack.yml`.

`grafana-datasources.yaml` staat er nog als losse referentie voor wie de stack aan een *andere*
Grafana wil hangen; voor deze opzet is hij niet nodig.

## 4. Verifiëren

Doe een chat en een keuzelijst-/structuur-ophaal in de webapp, dan in Grafana → **Explore**:
- **Tempo**: één trace `frontend → API → MCP` (gedeelde `trace_id`), plus de keten `frontend → graph-qa`.
- **Loki**: de gecorreleerde logregels (filter op `trace_id`); via de derived field spring je door naar
  de trace in Tempo.
- **Prometheus**: de auto-http-metrics (`http_server_duration_milliseconds_*`). Services onderscheiden
  via label `exported_job`. Uit de connectors: `traces_service_graph_request_total` (labels
  `client`/`server`/`connection_type`) en `traces_spanmetrics_calls_total`/`_duration_*` (labels
  `service_name`/`span_name`). Let op: de `http_client_*`-metric draagt **geen host/target-label**, dus
  per-bestemming-edges (frontend → API, API → Postgres) komen uit de service-graph, niet uit `http_client`.

## Aandachtspunten

- **Volume-rechten:** tempo en loki draaien met `user: "0:0"` zodat ze naar hun named volume kunnen
  schrijven (named volumes worden als root aangemaakt). Internal-only containers zonder host-mounts →
  laag risico; hard je desgewenst later met een pre-chown-init.
- **Loki OTLP:** vereist `allow_structured_metadata: true` (staat aan in `loki-config.yaml`) en Loki 3.x.
- **Geen auth op de backends:** ze zijn alleen intern bereikbaar op `observability_default` (geen
  hostpoorten). Alleen Grafana is van buiten benaderbaar, met zijn eigen login. Zet de backends niet
  achter NPM/host-poorten.

## 5. Dashboards importeren

Er zijn **twee** kant-en-klare dashboards (map "Wetsanalyse"):

De twee hebben een **duidelijke rolverdeling** (en linken naar elkaar): topologie = *live/ops*,
observability = *trends/analytics*. Metrics staan zo op één plek, zonder duplicatie.

- `grafana-dashboard-topologie.json` — *"Wetsanalyse — systeemtopologie"* (**live/ops**): de **live keten
  die oplicht** (Canvas: frontend → API/graph-qa → LLM/Postgres; met een rode **keten-fouten (15 min)**-badge),
  de **automatische Node Graph** (servicegraph-subset) en een **trace-waterfall + logs** om één executie te
  volgen. Geen trend-panels — die staan in het observability-dashboard (dashboardlink bovenin).
- `grafana-dashboard-wetsanalyse.json` — *"Wetsanalyse — observability"* (**trends/analytics**):
  HTTP (request-rate/latency-p95 met threshold-lijnen/foutrate + 5xx-foutratio), **scrape-health**
  (targets up/down), plus logs en traces.

Importeren:

- **UI:** Grafana → *Dashboards → New → Import* → upload het JSON-bestand → map "Wetsanalyse".
- **API/CI:** `provision-grafana.sh` importeert **beide** dashboards (idempotent), of
  `POST /api/dashboards/db` met body `{"dashboard": <inhoud>, "folderUid": "wetsanalyse",
  "overwrite": true}`.

Vereist de datasource-uid's **`wa-prometheus`**, **`wa-loki`**, **`wa-tempo`** (zoals in
`grafana-datasources.yaml`) en een map met uid `wetsanalyse`.

> **Systeemtopologie afronden.** De Canvas is bewust een startpunt: doorloopt/lichthoogte fijn je het
> makkelijkst interactief bij (*Edit → Canvas*). De node-queries voor frontend/Postgres/graph-qa
> leunen op de service-graph-metrics — draai eerst een chat zodat de connectors data hebben, en
> verifieer dan de labelwaarden (`client`/`server`) in *Explore* voordat je ze vastzet.

## 6. Frontend-logs naar Loki (Alloy)

De **API** logt via OTLP naar Loki. De **frontend** logt naar stdout/stderr; de `alloy`-service (in de
compose) scrapet die container-logs en pusht ze naar Loki (`alloy-config.alloy`). De config filtert
bewust op `wetsanalyse-frontend` (de API niet — die komt al via OTLP, dus geen dubbeling), zet
`service_name` op de containernaam, promoveert `niveau` → label `detected_level` en
`trace_id`/`categorie` → structured metadata.

- **Docker-socket:** alloy mount `/var/run/docker.sock` **read-only** (alleen containerlogs lezen).
- Verifiëren: Grafana → Explore → Loki → `{service_name="wetsanalyse-frontend"}` geeft logregels.

## 7. Alerting

`alerting/` bevat de definities (reproduceerbaar; de live-bron is de Grafana-provisioning-API):
- `alert-rules.json` — 3 regels in groep `wetsanalyse-1m` (map "Wetsanalyse"): HTTP 5xx,
  latency p95 > 5s, telemetrie-backend down (`up{job="otel-collector"}==0`). De regels dragen **geen
  eigen contactpunt** en volgen het **default notification-beleid** van je Grafana — richt daar je
  gewenste ontvanger in (e-mail, Slack, …).
- `apply.sh` — idempotent toepassen:
  `GRAFANA_URL=https://grafana.example GRAFANA_TOKEN=<sa-token> ./apply.sh`.

## 8. Reproduceerbare deploy (CI, één dispatch)

De hele observability-laag staat in één keer neer via **`.github/workflows/deploy-observability.yml`**
(`workflow_dispatch`, of automatisch bij een push op `deploy/observability/**`):

1. **Backends-stack** → Portainer (`docker-compose.stack.yml`, de self-contained variant met inline
   `configs:` — géén host-bestanden nodig). Idempotente PUT + wachten tot de 5 containers draaien.
2. **Grafana provisionen** → `provision-grafana.sh` (idempotent: de 3 datasources + de map + **beide**
   dashboards, `grafana-dashboard-wetsanalyse.json` én `grafana-dashboard-topologie.json`).
3. **Alerting** → `alerting/apply.sh` (de 3 regels; ze volgen het default notification-beleid).

Benodigde secrets/vars: `PORTAINER_URL`/`PORTAINER_API_KEY`/`vars.PORTAINER_OBSERVABILITY_STACK_ID`,
`GRAFANA_URL`/`GRAFANA_TOKEN`. Losse componenten draai je ook handmatig
(`provision-grafana.sh`, `alerting/apply.sh`).

> `docker-compose.stack.yml` is de **gedeployde** variant (inline configs, incl. Alloy); de
> `docker-compose.yml` hiernaast is de bindmount-variant voor lokaal/handmatig. Houd ze equivalent.
