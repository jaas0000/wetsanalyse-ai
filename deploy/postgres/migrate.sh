#!/usr/bin/env bash
# Eenmalige migratie: postgres uit de api-stack halen naar de aparte 'wetsanalyse-postgres'-stack,
# met behoud van het bestaande data-volume. Korte downtime (~30-60s; de draaiende API krijgt even
# DB-fouten en herstelt zodra de nieuwe postgres up is).
#
# HARD tegen de trage-daemon-race: de `rm` van de oude container kan via de reverse-proxy time-outen
# (504) terwijl de Docker-daemon 'm traag verwijdert. Daarom **pollen we tot de container écht weg is**
# vóór we de nieuwe stack aanmaken — anders faalt de create op een naam-conflict en ligt de DB eruit.
# Faalt de verwijdering, dan breekt het script af VÓÓR de destructieve create (veilig; start de oude
# container terug voor rollback).
#
# Vereist env:
#   PORTAINER_URL, PORTAINER_API_KEY, SECRETS_DIR
# Optioneel:
#   PORTAINER_ENDPOINT_ID (1), PROXY_NETWORK (homeinfra_internal),
#   VOLUME_NAME (wetsanalyse-api_wetsanalyse_postgres), CONTAINER_NAME (wetsanalyse-postgres)
set -euo pipefail
: "${PORTAINER_URL:?}"; : "${PORTAINER_API_KEY:?}"; : "${SECRETS_DIR:?}"
EID="${PORTAINER_ENDPOINT_ID:-1}"
NET="${PROXY_NETWORK:-homeinfra_internal}"
VOL="${VOLUME_NAME:-wetsanalyse-api_wetsanalyse_postgres}"
CNAME="${CONTAINER_NAME:-wetsanalyse-postgres}"
DOCKER="$PORTAINER_URL/api/endpoints/$EID/docker"
H=(-H "X-API-Key: $PORTAINER_API_KEY")
FILTER=$(python3 -c "import urllib.parse,json;print(urllib.parse.quote(json.dumps({'name':['$CNAME']})))")

cid() { curl -s "${H[@]}" "$DOCKER/containers/json?all=1&filters=$FILTER" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['Id'] if d else '')"; }

echo "1) volume-check ($VOL)"
curl -s "${H[@]}" "$DOCKER/volumes" | python3 -c "import sys,json;v=[x['Name'] for x in (json.load(sys.stdin).get('Volumes') or [])];sys.exit(0 if '$VOL' in v else 1)" \
  || { echo 'FOUT: volume niet gevonden — afgebroken (geen data-verlies).'; exit 1; }

echo "2) oude container stoppen + verwijderen (poll tot echt weg)"
id=$(cid)
if [ -n "$id" ]; then
  curl -s -o /dev/null -w "   stop: %{http_code}\n" --max-time 60 "${H[@]}" -X POST "$DOCKER/containers/$id/stop?t=20" || true
  gone=0
  for _ in $(seq 1 20); do
    curl -s -o /dev/null -w "   rm: %{http_code}\n" --max-time 60 "${H[@]}" -X DELETE "$DOCKER/containers/$id?force=1" || true
    sleep 4
    [ -z "$(cid)" ] && { gone=1; echo "   weg."; break; }
  done
  [ "$gone" -eq 1 ] || { echo "::error:: container blijft bestaan — afgebroken vóór create. Start 'm terug voor rollback."; exit 1; }
fi

echo "3) nieuwe postgres-stack aanmaken"
COMPOSE=$(cat "$(dirname "${BASH_SOURCE[0]}")/docker-compose.yml")
python3 - "$PORTAINER_API_KEY" "$PORTAINER_URL" "$COMPOSE" "$NET" "$SECRETS_DIR" "$EID" <<'PY'
import sys,json,urllib.request,urllib.error
tok,url,compose,net,secrets,eid=sys.argv[1:7]
payload={"name":"wetsanalyse-postgres","stackFileContent":compose,
         "env":[{"name":"PROXY_NETWORK","value":net},{"name":"SECRETS_DIR","value":secrets}]}
req=urllib.request.Request(f"{url}/api/stacks/create/standalone/string?endpointId={eid}",
    data=json.dumps(payload).encode(), headers={"X-API-Key":tok,"Content-Type":"application/json"}, method="POST")
try:
    r=json.load(urllib.request.urlopen(req,timeout=180))
    print("   STACK-ID:", r["Id"], "→ zet als repo-var PORTAINER_POSTGRES_STACK_ID")
except urllib.error.HTTPError as e:
    print("   HTTPError", e.code, e.read().decode()[:300]); sys.exit(1)
PY

echo "4) health"
for i in $(seq 1 18); do
  st=$(curl -s "${H[@]}" "$DOCKER/containers/$CNAME/json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('State',{}).get('Status','?'))" 2>/dev/null || echo '?')
  echo "   poging $i: $st"; [ "$st" = "running" ] && { echo "OK."; break; }; sleep 5
done
echo "Klaar. Zet PORTAINER_POSTGRES_STACK_ID en merge de api-compose-wijziging (postgres eruit)."
