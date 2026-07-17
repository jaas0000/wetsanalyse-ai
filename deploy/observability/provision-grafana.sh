#!/usr/bin/env bash
# Idempotente Grafana-provisioning voor de Wetsanalyse-observability: de 3 datasources, de map en het
# dashboard. Draait tegen een bestaande Grafana via de HTTP-API. Alerting staat apart in
# alerting/apply.sh. Vereist env: GRAFANA_URL, GRAFANA_TOKEN.
#
#   GRAFANA_URL=https://grafana.ipalm.nl GRAFANA_TOKEN=glsa_… ./provision-grafana.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${GRAFANA_URL:?zet GRAFANA_URL}"; : "${GRAFANA_TOKEN:?zet GRAFANA_TOKEN}"
AUTH=(-H "Authorization: Bearer ${GRAFANA_TOKEN}" -H "Content-Type: application/json")

# _http <outfile> <curl-args...>  — curl zonder -f (zodat 4xx/5xx niet via set -e killen);
# echo't de HTTP-code, schrijft de body naar <outfile>.
_http() {
  local out="$1"; shift
  curl -sS -o "$out" -w "%{http_code}" "$@"
}

# upsert_datasource <uid> <json>  — idempotent en robuust tegen een nog-opwarmende Grafana:
# een GET bepaalt PUT (bestaat) vs POST (nieuw), maar tolereert transiënte 5xx/000 met backoff
# (anders misroutet één 500 naar POST → 409). Een 409 op POST (race/bestond toch al) valt terug op PUT.
upsert_datasource() {
  local uid="$1" body="$2" code i
  code=""
  for i in 1 2 3 4 5; do
    code=$(_http /tmp/ds.json "${AUTH[@]:0:2}" -X GET "${GRAFANA_URL}/api/datasources/uid/${uid}")
    case "$code" in
      200|404) break ;;
      *) echo "  datasource ${uid}: GET http=$code — transiënt, retry ($i)"; sleep $((i*3)) ;;
    esac
  done
  if [ "$code" = "200" ]; then
    code=$(_http /tmp/ds.json "${AUTH[@]}" -X PUT -d "$body" "${GRAFANA_URL}/api/datasources/uid/${uid}")
    [ "${code:0:1}" = "2" ] && { echo "  datasource ${uid}: bijgewerkt"; return 0; }
    echo "::error::datasource ${uid}: PUT http=$code"; cat /tmp/ds.json; return 1
  fi
  code=$(_http /tmp/ds.json "${AUTH[@]}" -X POST -d "$body" "${GRAFANA_URL}/api/datasources")
  [ "${code:0:1}" = "2" ] && { echo "  datasource ${uid}: aangemaakt"; return 0; }
  if [ "$code" = "409" ]; then
    code=$(_http /tmp/ds.json "${AUTH[@]}" -X PUT -d "$body" "${GRAFANA_URL}/api/datasources/uid/${uid}")
    [ "${code:0:1}" = "2" ] && { echo "  datasource ${uid}: bijgewerkt (na 409)"; return 0; }
  fi
  echo "::error::datasource ${uid}: POST http=$code"; cat /tmp/ds.json; return 1
}

echo "== datasources =="
upsert_datasource wa-prometheus '{"name":"Prometheus (wetsanalyse)","uid":"wa-prometheus","type":"prometheus","access":"proxy","url":"http://prometheus:9090","isDefault":false,"jsonData":{"httpMethod":"POST"}}'
upsert_datasource wa-tempo '{"name":"Tempo (wetsanalyse)","uid":"wa-tempo","type":"tempo","access":"proxy","url":"http://tempo:3200","isDefault":false,"jsonData":{"serviceMap":{"datasourceUid":"wa-prometheus"},"nodeGraph":{"enabled":true},"tracesToLogsV2":{"datasourceUid":"wa-loki","spanStartTimeShift":"-1h","spanEndTimeShift":"1h","filterByTraceID":true}}}'
upsert_datasource wa-loki '{"name":"Loki (wetsanalyse)","uid":"wa-loki","type":"loki","access":"proxy","url":"http://loki:3100","isDefault":false,"jsonData":{"derivedFields":[{"name":"TraceID","matcherType":"label","matcherRegex":"trace_id","datasourceUid":"wa-tempo","url":"${__value.raw}"}]}}'

# Read-only jobstore-view voor de live jobs-tabel op het systeemtopologie-dashboard. Alleen provisionen als het
# wachtwoord is meegegeven (env GRAFANA_WA_PG_PASSWORD = het host-secret grafana_pg_password). De rol
# grafana_ro + de view dashboard_jobs komen uit deploy/postgres/grafana-readonly.sql (eenmalig draaien).
if [ -n "${GRAFANA_WA_PG_PASSWORD:-}" ]; then
  upsert_datasource wa-postgres "{\"name\":\"Jobstore (wetsanalyse)\",\"uid\":\"wa-postgres\",\"type\":\"postgres\",\"access\":\"proxy\",\"url\":\"postgres:5432\",\"user\":\"grafana_ro\",\"isDefault\":false,\"jsonData\":{\"database\":\"wetsanalyse\",\"sslmode\":\"disable\",\"postgresVersion\":1600},\"secureJsonData\":{\"password\":\"${GRAFANA_WA_PG_PASSWORD}\"}}"
else
  echo "  datasource wa-postgres: OVERGESLAGEN (zet GRAFANA_WA_PG_PASSWORD om de jobs-tabel te voeden)"
fi

echo "== map 'Wetsanalyse' =="
curl -fsS -X POST "${AUTH[@]}" -d '{"uid":"wetsanalyse","title":"Wetsanalyse"}' "${GRAFANA_URL}/api/folders" >/dev/null 2>&1 \
  && echo "  map aangemaakt" || echo "  map bestond al"

echo "== dashboards =="
import_dashboard() {
  local file="$1"
  python3 - "$file" > /tmp/dash-payload.json <<'PY'
import sys, json
dash = json.load(open(sys.argv[1]))
dash["id"] = None
json.dump({"dashboard": dash, "folderUid": "wetsanalyse", "overwrite": True,
          "message": "provisioned via CI"}, sys.stdout)
PY
  curl -fsS -X POST "${AUTH[@]}" -d @/tmp/dash-payload.json "${GRAFANA_URL}/api/dashboards/db" >/dev/null
  echo "  dashboard geïmporteerd: $(basename "$file")"
}
import_dashboard "$DIR/grafana-dashboard-wetsanalyse.json"   # "Wetsanalyse — observability" (trends)
import_dashboard "$DIR/grafana-dashboard-topologie.json"     # "Wetsanalyse — systeemtopologie" (live keten)
echo "klaar."
