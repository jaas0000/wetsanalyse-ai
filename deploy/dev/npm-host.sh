#!/usr/bin/env bash
# Maak/verwijder een nginx-proxy-manager proxy-host voor de dev-omgeving (https via een bestaand
# certificaat). OPTIONEEL — draait alleen als NPM_URL gezet is. De NPM-API varieert licht per versie;
# verifieer/pas aan bij de eerste run (niet lokaal te testen).
#
# NPM draait op een andere LXC dan de docker-host, dus <forward_host> is het IP van die docker-host
# (bv. 192.168.10.23) met de gepubliceerde poort — niet een containernaam.
#
# Gebruik:  npm-host.sh create <host> <forward_host> <forward_port>
#           npm-host.sh delete <host>
# Env:  NPM_URL, NPM_IDENTITY, NPM_SECRET, NPM_CERT_ID (id van het certificaat in NPM).
set -euo pipefail

ACTION="${1:?create|delete}"; HOST="${2:?host}"
: "${NPM_URL:?zet NPM_URL}"; : "${NPM_IDENTITY:?zet NPM_IDENTITY}"; : "${NPM_SECRET:?zet NPM_SECRET}"

api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

TOKEN="$(curl -sS -X POST "$NPM_URL/api/tokens" -H "Content-Type: application/json" \
          -d "$(jq -n --arg i "$NPM_IDENTITY" --arg s "$NPM_SECRET" '{identity:$i,secret:$s}')" \
          | jq -r '.token')"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "::error::NPM-login mislukt"; exit 1; }

# Bestaande host-id (op domeinnaam).
HID="$(api "$NPM_URL/api/nginx/proxy-hosts" | jq -r --arg h "$HOST" '.[] | select(.domain_names[]? == $h) | .id' | head -n1)"

case "$ACTION" in
  create)
    FWD_HOST="${3:?forward_host}"; FWD_PORT="${4:?forward_port}"
    # SSE-streams (de agent) mogen niet gebufferd worden.
    ADV='proxy_buffering off;'
    BODY="$(jq -n --arg h "$HOST" --arg fh "$FWD_HOST" --argjson fp "$FWD_PORT" \
              --argjson cert "${NPM_CERT_ID:-0}" --arg adv "$ADV" \
      '{domain_names:[$h], forward_scheme:"http", forward_host:$fh, forward_port:$fp,
        certificate_id:$cert, ssl_forced:true, http2_support:true, block_exploits:true,
        allow_websocket_upgrade:true, advanced_config:$adv, meta:{letsencrypt_agree:false}}')"
    if [ -n "${HID:-}" ] && [ "$HID" != "null" ]; then
      api -X PUT "$NPM_URL/api/nginx/proxy-hosts/$HID" -d "$BODY" >/dev/null && echo "NPM-host bijgewerkt: $HOST"
    else
      api -X POST "$NPM_URL/api/nginx/proxy-hosts" -d "$BODY" >/dev/null && echo "NPM-host aangemaakt: $HOST"
    fi
    ;;
  delete)
    if [ -n "${HID:-}" ] && [ "$HID" != "null" ]; then
      api -X DELETE "$NPM_URL/api/nginx/proxy-hosts/$HID" >/dev/null && echo "NPM-host verwijderd: $HOST"
    else
      echo "Geen NPM-host $HOST — niets te doen."
    fi
    ;;
  *) echo "onbekende actie: $ACTION"; exit 1 ;;
esac
