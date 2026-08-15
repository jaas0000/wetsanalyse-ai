# deploy/proxmox — waakhonden op de host

Wat hier staat draait **op pve01 zelf**, niet in een container. Dat is geen detail maar de reden van
bestaan: op 15 augustus 2026 liep de rootfs van de docker-LXC vol en viel alles op die host stil —
inclusief de Prometheus/Grafana/Loki-stack die het had moeten melden en de Portainer waarmee je had
kunnen kijken. Een waakhond die op de zieke host slaapt, blaft niet.

## `schijfwacht.sh`

Waarschuwt vóórdat een LXC-rootfs of een storage volloopt. Geen output = niets aan de hand; cron
mailt root alleen bij output, dus je hoort hem alleen als het nodig is.

```bash
# als root op pve01
install -m 755 schijfwacht.sh /usr/local/sbin/schijfwacht
printf '17 * * * * root /usr/local/sbin/schijfwacht\n' > /etc/cron.d/schijfwacht

# controleren dat hij werkt (drempel 0 = alles melden)
DREMPEL=0 /usr/local/sbin/schijfwacht
```

Drempel staat op 85%. Controleer wel even dat root-mail ergens aankomt (`postconf -n`,
`/etc/aliases`) — anders schrijft hij in het luchtledige.

## Wat hij níét doet

Hij meet de **rootfs zoals Proxmox die rapporteert**, niet wat er ín een container aan images of
volumes ligt. Voor het waaróm van een volle docker-LXC blijft `docker system df` het gereedschap.
Het opruimen zelf hoort bij het uitrollen: `.github/workflows/dev-deploy.yml` doet na elke deploy een
image-prune (ongebruikt en ouder dan een week).

## Achtergrond: wat er die dag misging

Twee storingen tegelijk, allebei buiten de applicatiecode:

1. **Rootfs 100% vol.** 92 images op 28 GB, waarvan ~40 GB ongebruikt. Docker draaide nog maar kon
   niets meer wegschrijven, dus zweeg elke container. Opgelost met `pct resize 103 rootfs +10G`.
   Structureel: prune bij elke deploy (hierboven) én `WATCHTOWER_CLEANUP=true` op de watchtower-
   container — die haalde bij elke update een nieuw image binnen en liet het oude staan.
2. **De LXC stond niet meer op zijn gereserveerde IP.** UniFi had `192.168.10.23` gereserveerd, de
   container zat op `192.168.10.207`, en nginx-proxy-manager wijst naar het eerste. Alles op die host
   gaf 502 terwijl de containers gewoon draaiden. Een reverse proxy die op een IP-adres mikt hoort
   niet naar een DHCP-client te wijzen: zet het adres vast in de LXC-configuratie.
