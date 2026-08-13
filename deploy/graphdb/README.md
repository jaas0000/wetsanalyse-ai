# GraphDB op de docker-LXC — verhuizen vanaf de NAS

De BWB-kennisgraaf draaide tot 25 juli 2026 op de Synology (`/volume1/docker/graphdb/home`, stack
`neo4j` in de NAS-Portainer) en is toen gestopt. Deze map zet hem terug op de **docker-LXC** van
Proxmox, met de data **lokaal** — de NAS blijft back-upbestemming.

Twee containers, geen aparte MCP-server: **GraphDB ≥ 11.2 heeft de MCP-server ingebouwd** op
`/mcp` (poort 7200). Het nginx'je ervoor doet alleen de bearer-tokencontrole voor toegang van buiten.

## Waarom de data niet op de NAS blijft staan

GraphDB's opslaglaag gebruikt geheugen-gemapte bestanden en file-locking. Over NFS is dat traag en
kan een netwerkhapering stille indexcorruptie geven; Ontotext raadt netwerkopslag voor de
datadirectory af. Wil je de opslag tóch fysiek op de NAS, gebruik dan een **iSCSI-LUN** (blockdevice
met correcte locking) in plaats van een NFS-bind.

## Verhuizen

### 1. Data kopiëren (NAS → LXC)

De bronmap staat op de NAS en is met SSH te benaderen (poort 22 staat open). Meet eerst hoe groot
het is, zodat je weet of dit minuten of een uur kost:

```bash
ssh <gebruiker>@192.168.10.10 'du -sh /volume1/docker/graphdb/home'
```

Kopieer daarna vanaf de **LXC** (`pct enter 103` op pve01, of ssh naar 192.168.10.23):

```bash
mkdir -p /var/lib/graphdb/home
rsync -aH --info=progress2 <gebruiker>@192.168.10.10:/volume1/docker/graphdb/home/ /var/lib/graphdb/home/
```

De GraphDB-container op de NAS staat stil, dus de data is in rust — een consistente kopie. Start
hem tijdens het kopiëren niet alsnog op.

> Past het? De LXC-rootfs is 28 GB (was 4 GB). Is de graaf groter dan ~20 GB, vergroot dan eerst
> verder met `pct resize 103 rootfs +XG` op `pve01`.

### 2. Rechten

GraphDB draait in de container als uid **1000**:

```bash
chown -R 1000:1000 /var/lib/graphdb/home
```

### 3. Stack deployen

Via `.github/workflows/deploy-graaf.yml` (handmatig of bij wijzigingen in `deploy/graphdb/**`).
Die deployt de graphdb-stack en de importer in de juiste volgorde — GraphDB eerst, want die maakt het
netwerk `graphdb_default` waar de andere stacks op joinen — en controleert daarna of de repository
`inning` antwoordt. Handmatig via Portainer (`portainer.ipalm.nl`, endpoint 3) kan ook, met deze env:

| var | waarde |
|---|---|
| `MCP_BEARER_TOKEN` | hetzelfde token als `secrets.GRAPHDB_TOKEN` in GitHub — anders komt graph-qa er niet in |
| `GRAPHDB_HEAP` | `2g` (bij 4 GB LXC-RAM liever `1500m`, of til de LXC naar 8 GB) |

### 4. Controleren

```bash
curl -s http://192.168.10.23:7200/rest/repositories | jq -r '.[].id'   # verwacht: inning
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.10.23:8004/mcp # 401 zonder token = goed
```

### 5. De dev-omgeving aansluiten

De dev-stack joint op het externe netwerk `graphdb_default` en praat dan intern met
`http://mcp-auth-proxy:8004/mcp` — geen omweg via de proxy en geen TLS nodig. Dat netwerk wordt
door déze stack aangemaakt, dus deploy GraphDB **vóór** een nieuwe dev-deploy.

Wil je de graaf ook van buiten bereikbaar maken (bijvoorbeeld voor de MCP in `.mcp.json`), maak dan
in nginx-proxy-manager een host `graphdb-mcp.ipalm.nl` → `192.168.10.23:8004` met
`proxy_buffering off;`. Die host bestaat sinds de verhuizing niet meer.

## BWB's importeren

De importservice draait naast de graaf op dezelfde LXC: stack **`bwb-import`**, broncode in
`tools/bwb-import/`, image via GHCR. Zie `deploy/bwb-import/README.md` voor het aanroepen.

## Back-up — twee lagen

**1. RDF-dump, dagelijks 03:00** — service `graphdb-backup` in deze stack. Exporteert de repository
als **N-Quads** (houdt de named graphs vast; TriG/Turtle zou de contexts verliezen) naar
`/var/lib/graphdb/backup/inning-<datum>.nq.gz`, retentie 7. De dump schrijft naar `.tmp` en
hernoemt pas bij succes, zodat een afgebroken run geen half bestand achterlaat dat er als geldige
back-up uitziet. Log: `/var/lib/graphdb/backup/backup.log`.

**2. vzdump, dagelijks 03:30** — de bestaande Proxmox-back-upjob draait met `--all` en pakt LXC 103
dus automatisch mee, met retentie `keep-daily=7, keep-weekly=4` naar `synology-backup`. De volgorde
is bewust: de dump van 03:00 ligt er al en lift mee naar de NAS.

Waarom allebei: vzdump maakt een LVM-snapshot met fs-freeze — filesystem-consistent, maar GraphDB
kan midden in een schrijfactie zitten. De RDF-export is per definitie applicatie-consistent. De
vzdump geeft een complete LXC terug, de dump geeft gegarandeerd leesbare data.

Handmatig een dump draaien:

```bash
docker exec graphdb-backup /usr/local/bin/dump.sh
```

### Herstellen — geverifieerd

> **Restore-test 13 aug 2026.** De dump van die nacht (03:00) is teruggeladen in een tijdelijke
> repository: **388.161 triples, gelijk aan productie**, en een steekproef op artikel 2 lid 1
> onderdeel k leverde de juiste definitie op. Herladen duurde 7,5 seconde. Een back-up die je niet
> hebt teruggezet is een aanname; deze is dat niet meer.

Uit de **vzdump**: de hele LXC terug, inclusief afgeleide structuren.

Uit de **RDF-dump**: maak een lege repository `inning` en laad de quads:

```bash
zcat inning-<datum>.nq.gz | curl -X POST -H 'Content-Type: application/n-quads' \
  --data-binary @- http://192.168.10.23:7200/repositories/inning/statements
```

> Let op: een RDF-dump bevat de triples, maar niet de **afgeleide** structuren — met name de
> similarity-index `bwb_similarity` (die graph-qa nodig heeft voor `semantic_search`) moet daarna
> opnieuw gebouwd worden. Uit de vzdump komt die wél mee.
