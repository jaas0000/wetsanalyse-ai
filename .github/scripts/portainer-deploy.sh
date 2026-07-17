#!/usr/bin/env bash
# Gedeelde Portainer-redeploy met convergentie-verificatie voor de app-stacks (api/frontend/mcp).
#
# Waarom: een Portainer stack-update doet een in-place `docker compose up`. Op de (trage) Synology-
# daemon kan de recreate transient struikelen op "removal of container … already in progress" (HTTP
# 500), waarna de stack half-applied blijft: de NIEUWE container blijft in `Created` staan terwijl de
# OUDE blijft draaien. Een kale `/health`-check kan dan false-passen (de oude container antwoordt) →
# groen terwijl de nieuwe image niet draait. Dit script convergeert actief naar "precies één verse,
# gezonde container op de verwachte image, geen orphans" en faalt anders met de containerlogs.
#
# Gebruik:
#   portainer-deploy.sh <payload_file> <service_name> <expected_image_ref> <health_url>
# Env (verplicht): PORTAINER_URL, PORTAINER_API_KEY, PORTAINER_STACK_ID
# Env (optioneel):  PORTAINER_ENDPOINT_ID (default 1)
set -euo pipefail

PAYLOAD_FILE="${1:?payload-bestand ontbreekt}"
SERVICE="${2:?servicenaam ontbreekt}"
EXPECTED_REF="${3:?verwachte image-ref ontbreekt}"    # ghcr.io/…@sha256:<digest>
HEALTH_URL="${4:-}"

: "${PORTAINER_URL:?zet PORTAINER_URL}"
: "${PORTAINER_API_KEY:?zet PORTAINER_API_KEY}"
: "${PORTAINER_STACK_ID:?zet PORTAINER_STACK_ID}"
EID="${PORTAINER_ENDPOINT_ID:-1}"

API="$PORTAINER_URL/api"
DOCKER="$API/endpoints/$EID/docker"
DIGEST_SHA="${EXPECTED_REF##*@}"   # sha256:… (leeg als er geen @ in zit → dan telt alleen versheid)

curl_p() { curl -sS -H "X-API-Key: $PORTAINER_API_KEY" "$@"; }

# --- 1. Stack-PUT met idempotente retry op de transiënte 5xx-recreate-race ---------------------
deploy_put() {
  curl_p -X PUT --max-time 300 \
    "$API/stacks/$PORTAINER_STACK_ID?endpointId=$EID" \
    -H "Content-Type: application/json" \
    --data-binary "@$PAYLOAD_FILE" -o /tmp/portainer-resp.json -w "%{http_code}"
}

put_met_retry() {
  local attempt rc code backoff
  for attempt in 1 2 3; do
    rc=0
    code=$(deploy_put) || rc=$?
    echo "stack-PUT poging $attempt: curl_rc=$rc http=$code"
    if [ "$rc" -ne 0 ]; then
      echo "::warning::curl-fout (rc=$rc, bv. timeout) — update draait mogelijk async door; convergentie-check is bepalend."
      return 0
    fi
    case "$code" in
      2*) echo "Stack-update geaccepteerd."; return 0 ;;
      4*) echo "::error::Stack-update geweigerd (HTTP $code — config/auth)"; cat /tmp/portainer-resp.json || true; return 1 ;;
      *)  if [ "$attempt" -lt 3 ]; then
            backoff=$((attempt * 45))
            echo "::warning::HTTP $code — vermoedelijk transiënte recreate-race; backoff ${backoff}s en opnieuw…"
            sleep "$backoff"
          else
            echo "::warning::HTTP $code na 3 pogingen — convergentie-check is bepalend."
          fi ;;
    esac
  done
  return 0
}

# Docker name-filter matcht substring → vangt zowel `<service>` als een `<hash>_<service>`-orphan.
lijst_containers() {
  local filter; filter=$(printf '{"name":["%s"]}' "$SERVICE")
  curl_p --get --max-time 30 "$DOCKER/containers/json" \
    --data-urlencode "all=1" --data-urlencode "filters=$filter"
}

verwijder_container() {
  curl_p -X DELETE --max-time 60 "$DOCKER/containers/$1?force=1" -o /dev/null -w "%{http_code}" || true
}

toon_logs() {
  echo "---- laatste logs van $SERVICE ----"
  local id
  id=$(lijst_containers | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['Id'] if d else '')" 2>/dev/null || true)
  [ -n "$id" ] && curl_p --max-time 30 "$DOCKER/containers/$id/logs?stdout=1&stderr=1&tail=60" | tr -d '\000-\010\013\014\016-\037' || true
}

# --- 2+3. Converge: orphans opruimen; verifieer één verse, gezonde container op de nieuwe image ---
converge() {
  local start; start=$(date -u +%s)
  local i containers info state verdict orphan_ids
  for i in $(seq 1 24); do   # ~6 min (24×15s)
    containers=$(lijst_containers || echo "[]")
    # Classificeer met python: verwijder orphans, beoordeel de running-container.
    info=$(printf '%s' "$containers" | START="$start" DIGEST="$DIGEST_SHA" python3 -c '
import sys, os, json
start = int(os.environ["START"]); digest = os.environ.get("DIGEST","")
try: cs = json.load(sys.stdin)
except Exception: cs = []
orphans, running = [], []
for c in cs:
    st = c.get("State")
    if st in ("created", "exited", "dead"):
        orphans.append(c["Id"])
    elif st == "running":
        running.append(c)
# uitkomst: orphan-ids (spatie-gescheiden) | verdict | detail
verdict = "wacht"
if len(running) == 1 and not orphans:
    c = running[0]
    status = c.get("Status", "")
    vers = int(c.get("Created", 0)) >= start
    imgok = bool(digest) and digest in (c.get("Image") or "")
    # Gezond = expliciet (healthy), of geen healthcheck (geen "(health" in status).
    gezond = ("(healthy)" in status) or ("(health" not in status)
    if (vers or imgok) and gezond:
        verdict = "ok"
    elif ("(unhealthy)" in status):
        verdict = "unhealthy"
print(" ".join(orphans) + "|" + verdict)
')
    orphan_ids="${info%%|*}"; verdict="${info##*|}"
    if [ -n "${orphan_ids// /}" ]; then
      echo "orphan-container(s) opruimen: $orphan_ids"
      for oid in $orphan_ids; do echo "  DELETE $oid -> $(verwijder_container "$oid")"; done
      put_met_retry
      sleep 10
      continue
    fi
    case "$verdict" in
      ok) echo "Convergentie OK: één verse, gezonde $SERVICE-container op de nieuwe image."; return 0 ;;
      *)  echo "nog niet geconvergeerd (verdict=$verdict, poging $i) — wachten…"; sleep 15 ;;
    esac
  done
  echo "::error::$SERVICE convergeerde niet naar één verse gezonde container op de nieuwe image."
  toon_logs
  return 1
}

# --- 4. Externe health-check als laatste net ---------------------------------------------------
externe_health() {
  [ -z "$HEALTH_URL" ] && return 0
  echo "Externe health-verificatie op $HEALTH_URL ..."
  local i
  for i in $(seq 1 20); do
    if curl -fsS --max-time 10 "$HEALTH_URL" -o /dev/null; then
      echo "Extern gezond (poging $i)."; return 0
    fi
    sleep 15
  done
  echo "::error::Extern niet gezond na redeploy ($HEALTH_URL)."
  return 1
}

put_met_retry
converge
externe_health
echo "Deploy van $SERVICE afgerond en geverifieerd."
