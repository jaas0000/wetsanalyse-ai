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

# upsert_datasource <uid> <json>  — POST (nieuw) of PUT (bestaat al) op basis van de uid.
upsert_datasource() {
  local uid="$1" body="$2" code
  code=$(curl -fsS "${AUTH[@]:0:2}" -o /tmp/ds.json -w "%{http_code}" "${GRAFANA_URL}/api/datasources/uid/${uid}" || true)
  if [ "$code" = "200" ]; then
    curl -fsS -X PUT "${AUTH[@]}" -d "$body" "${GRAFANA_URL}/api/datasources/uid/${uid}" >/dev/null
    echo "  datasource ${uid}: bijgewerkt"
  else
    curl -fsS -X POST "${AUTH[@]}" -d "$body" "${GRAFANA_URL}/api/datasources" >/dev/null
    echo "  datasource ${uid}: aangemaakt"
  fi
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
