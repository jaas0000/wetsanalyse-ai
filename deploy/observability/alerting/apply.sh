#!/usr/bin/env bash
# Past het webhook-contactpunt + de 4 alertregels toe op de bestaande Grafana via de
# provisioning-API. Idempotent: contactpunt en regels worden geüpsert (X-Disable-Provenance:true
# houdt ze UI-bewerkbaar). Vereist env: GRAFANA_URL, GRAFANA_TOKEN.
#
#   GRAFANA_URL=https://grafana.ipalm.nl GRAFANA_TOKEN=glsa_... ./apply.sh
#
# De map "wetsanalyse" (folderUID) en de datasource-uid's wa-prometheus/wa-loki/wa-tempo moeten
# bestaan (zie README). Pas de webhook-URL in contact-point.json aan naar je eigen n8n-webhook.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${GRAFANA_URL:?zet GRAFANA_URL}"; : "${GRAFANA_TOKEN:?zet GRAFANA_TOKEN}"

hdr=(-H "Authorization: Bearer ${GRAFANA_TOKEN}" -H "Content-Type: application/json" -H "X-Disable-Provenance: true")

echo "== contactpunt =="
name=$(python3 -c "import json;print(json.load(open('$DIR/contact-point.json'))['name'])")
# bestaat het al? dan PUT (update), anders POST (create)
if curl -fsS "${hdr[@]:0:2}" "${GRAFANA_URL}/api/v1/provisioning/contact-points" | python3 -c "import sys,json;n='$name';sys.exit(0 if any(c.get('name')==n for c in json.load(sys.stdin)) else 1)"; then
  uid=$(curl -fsS "${hdr[@]:0:2}" "${GRAFANA_URL}/api/v1/provisioning/contact-points" | python3 -c "import sys,json;n='$name';print(next(c['uid'] for c in json.load(sys.stdin) if c.get('name')==n))")
  curl -fsS -X PUT "${hdr[@]}" -d @"$DIR/contact-point.json" "${GRAFANA_URL}/api/v1/provisioning/contact-points/${uid}" >/dev/null && echo "  bijgewerkt ($uid)"
else
  curl -fsS -X POST "${hdr[@]}" -d @"$DIR/contact-point.json" "${GRAFANA_URL}/api/v1/provisioning/contact-points" >/dev/null && echo "  aangemaakt"
fi

echo "== alertregels =="
python3 - "$DIR" "$GRAFANA_URL" "$GRAFANA_TOKEN" <<'PY'
import sys,json,urllib.request,urllib.error
d,url,tok=sys.argv[1],sys.argv[2],sys.argv[3]
rules=json.load(open(f"{d}/alert-rules.json"))
H={"Authorization":f"Bearer {tok}","Content-Type":"application/json","X-Disable-Provenance":"true"}
# bestaande regels van de groep ophalen (titel → uid) om te upserten
existing={}
try:
    req=urllib.request.Request(f"{url}/api/v1/provisioning/alert-rules",headers={"Authorization":f"Bearer {tok}"})
    for r in json.load(urllib.request.urlopen(req,timeout=30)):
        existing[r.get("title")]=r.get("uid")
except Exception as e:
    print("  (kon bestaande regels niet ophalen:",e,")")
for rule in rules:
    t=rule["title"]; uid=existing.get(t)
    try:
        if uid:
            rule2=dict(rule); rule2["uid"]=uid
            req=urllib.request.Request(f"{url}/api/v1/provisioning/alert-rules/{uid}",data=json.dumps(rule2).encode(),headers=H,method="PUT")
            urllib.request.urlopen(req,timeout=30); print(f"  bijgewerkt: {t}")
        else:
            req=urllib.request.Request(f"{url}/api/v1/provisioning/alert-rules",data=json.dumps(rule).encode(),headers=H,method="POST")
            urllib.request.urlopen(req,timeout=30); print(f"  aangemaakt: {t}")
    except urllib.error.HTTPError as e:
        print(f"  FOUT bij {t}: HTTP {e.code}: {e.read().decode()[:300]}")
PY
echo "klaar."
