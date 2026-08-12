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

Via Portainer (`portainer.ipalm.nl`, endpoint 3) als stack `graphdb`, met deze env:

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

Op de NAS staat stack **`bwb-import`** (id 230): een eigen importservice op
`http://bwb-import:8000/import` die naar `graphdb:7200`, repository `inning` schrijft, met
`BWB_IMPORT_WTI=true` voor de organisatie-/wetsfamilie-verrijking. Die stack bouwt uit een lokale
context (`build: context: .`) die **niet in deze repo staat** — verhuis je de import mee, dan moet
die broncode mee (of opnieuw gebouwd worden). De aanroep liep via n8n, dat inmiddels uit het
platform is; een directe POST naar `/import` volstaat.

## Back-up

De data staat nu lokaal. Zet een periodieke dump terug naar de NAS, bijvoorbeeld via de
GraphDB-API (`POST /rest/repositories/inning/statements/export` of een repository-dump) of door
`/var/lib/graphdb/home` te rsyncen naar `/volume1/docker/graphdb/backup/`. Zonder dat is de
enige kopie de oude NAS-map, die na de verhuizing bevriest.
