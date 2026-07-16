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
- **otel-collector** (`otel/opentelemetry-collector-contrib`) — ontvangt OTLP op 4317/4318.
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
- **Prometheus**: `wetsanalyse_fase_duur_ms`, `wetsanalyse_fase_fouten`, `wetsanalyse_llm_tokens`,
  `wettenbank_cache_toegang` en de auto-http-metrics (OTel-puntjes worden `_` in Prometheus).

## Aandachtspunten

- **Volume-rechten:** tempo en loki draaien met `user: "0:0"` zodat ze naar hun named volume kunnen
  schrijven (named volumes worden als root aangemaakt). Internal-only containers zonder host-mounts →
  laag risico; hard je desgewenst later met een pre-chown-init.
- **Loki OTLP:** vereist `allow_structured_metadata: true` (staat aan in `loki-config.yaml`) en Loki 3.x.
- **Geen auth op de backends:** ze zijn alleen intern bereikbaar op `homeinfra_internal`. Zet ze niet
  achter NPM/host-poorten.
