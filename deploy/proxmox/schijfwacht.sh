#!/usr/bin/env bash
# Schijfwacht voor pve01: waarschuwt vóórdat een LXC-rootfs of een storage volloopt.
#
# Draait BEWUST op de Proxmox-host en niet in een container. De storing die hij moet opmerken is
# precies "de container-host kan niets meer wegschrijven" — een waakhond die dáár draait, zwijgt op
# het moment dat het ertoe doet. Op 15 aug 2026 liep de docker-LXC vol (28 GB, 100%); Docker draaide
# nog maar geen enkele container reageerde, en de hele observability-stack die het had moeten melden
# stond op diezelfde LXC.
#
# Geen output betekent: niets aan de hand. Dat is opzet — cron mailt root alleen als een taak iets
# schrijft, dus zo krijg je bericht wanneer het misgaat en verder nooit.
#
# Installeren (als root op pve01):
#   install -m 755 schijfwacht.sh /usr/local/sbin/schijfwacht
#   printf '17 * * * * root /usr/local/sbin/schijfwacht\n' > /etc/cron.d/schijfwacht
# Controleer dat root-mail ergens aankomt (`postconf -n`, /etc/aliases), anders schrijft hij in het
# luchtledige. Even handmatig draaien met DREMPEL=0 laat zien dat hij werkt.

set -euo pipefail

DREMPEL=${DREMPEL:-85}          # procent; erboven volgt een melding
NODE=${NODE:-$(hostname)}

meld() { echo "SCHIJFWACHT $NODE: $*"; }

# --- de rootfs van elke container -------------------------------------------------------------
# `disk`/`maxdisk` zijn wat Proxmox zelf rapporteert; dat is dezelfde meting die je in de webinterface
# ziet. Een gestopte container meldt disk=0 — die slaan we over in plaats van hem als 0% te tellen.
pvesh get "/nodes/$NODE/lxc" --output-format json |
  jq -r '.[] | select(.status == "running") | "\(.vmid)\t\(.name)"' |
  while IFS=$'\t' read -r vmid naam; do
    status=$(pvesh get "/nodes/$NODE/lxc/$vmid/status/current" --output-format json)
    disk=$(printf '%s' "$status" | jq -r '.disk // 0')
    maxdisk=$(printf '%s' "$status" | jq -r '.maxdisk // 0')
    [ "$maxdisk" -gt 0 ] || continue
    pct=$(( disk * 100 / maxdisk ))
    if [ "$pct" -ge "$DREMPEL" ]; then
      meld "LXC $vmid ($naam) rootfs $pct% vol — $(numfmt --to=iec "$disk") van $(numfmt --to=iec "$maxdisk")"
    fi
  done

# --- en de storages van de node zelf ----------------------------------------------------------
# Ook de back-upbestemming: die loopt net zo stil vol, en dan mislukken de vzdumps zonder dat iemand
# het merkt tot je een restore nodig hebt.
pvesh get "/nodes/$NODE/storage" --output-format json |
  jq -r '.[] | select(.active == 1 and .total > 0) | "\(.storage)\t\(.used)\t\(.total)"' |
  while IFS=$'\t' read -r naam used total; do
    pct=$(( used * 100 / total ))
    if [ "$pct" -ge "$DREMPEL" ]; then
      meld "storage $naam $pct% vol — $(numfmt --to=iec "$used") van $(numfmt --to=iec "$total")"
    fi
  done
