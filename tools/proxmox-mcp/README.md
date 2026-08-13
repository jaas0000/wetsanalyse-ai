# proxmox-mcp

Read-only MCP-server (stdio) die de **Proxmox VE-API** als agent-tools ontsluit: nodes, VM's en
containers, hun configuratie en status, snapshots, storage, netwerk, taken en RRD-statistieken.

Zelfde opzet als `tools/wetsanalyse-admin-mcp/`: één `src/index.ts`, declaratieve tool-lijst,
JSON-logs naar stderr, fail-closed op ontbrekende env.

## Read-only is een eigenschap van de code

Er is precies één HTTP-helper (`pveGet`) en die doet uitsluitend `GET`. Er bestaat geen code-pad
dat `POST`, `PUT` of `DELETE` uitvoert. Geen enkele tool kan dus iets starten, stoppen, wijzigen of
verwijderen — ook niet wanneer het API-token ruimere rechten zou hebben dan nodig.

Dat is bewust dubbel gezekerd: het token krijgt daarnaast alleen audit-privileges (zie hieronder).
Wil je later power management (start/stop/snapshots), dan is dat een expliciete uitbreiding van
zowel de rol als deze server.

## Configuratie

Alles via env; niets hiervan hoort in de repo behalve de niet-geheime waarden.

| Variabele | Verplicht | Betekenis |
|---|---|---|
| `PROXMOX_URL` | ja | Basis-URL zonder `/api2/json`, bv. `https://proxmox.ipalm.nl` |
| `PROXMOX_TOKEN_ID` | ja | Token-id in de vorm `gebruiker@realm!tokennaam` |
| `PROXMOX_TOKEN_SECRET` | ja | Het secret dat `pveum user token add` eenmalig toont |
| `PROXMOX_NODE` | nee | Default-node als een tool er geen meekrijgt |

Zonder de eerste drie weigert de server te starten. Het secret wordt nooit gelogd; stdout is
exclusief voor het MCP-protocol.

In dit project staat de registratie in `.mcp.json`; het secret komt uit
`.claude/settings.local.json` (gitignored), net als `WETTENBANK_TOKEN` en `GRAFANA_TOKEN`.

## Proxmox-zijde inrichten

Op de Proxmox-host, als root:

```bash
# gebruiker + read-only rol
pveum user add mcp@pve --comment "MCP-koppeling Claude Code"
pveum role add MCPReadOnly --privs "VM.Audit,Datastore.Audit,Sys.Audit,Pool.Audit,SDN.Audit"
pveum acl modify / --user mcp@pve --role MCPReadOnly

# token met privilege separation
pveum user token add mcp@pve claude --privsep 1

# rechten aan het token zélf — zonder deze regel kan het token niets
pveum acl modify / --token 'mcp@pve!claude' --role MCPReadOnly
```

Controleren:

```bash
pveum user permissions 'mcp@pve!claude' --path /
```

Intrekken:

```bash
pveum user token remove mcp@pve claude
```

## Bouwen en draaien

```bash
npm install
npm run build      # TypeScript → dist/
npm start          # stdio-server (verwacht de env-vars)
npm run dev        # via tsx, zonder build
```

Na een wijziging: `npm run build`, daarna `claude mcp list` → verwacht `proxmox → ✓ Connected`.

## Tools

**Cluster en nodes**

| Tool | Doet |
|---|---|
| `get_version` | PVE-versie; bruikbaar als verbindings-/authenticatietest |
| `list_nodes` | Nodes met status, uptime, CPU- en geheugengebruik |
| `get_cluster_status` | Quorum en online-status van de nodes |
| `list_resources` | Alle resources in één overzicht (`type`: vm/storage/node/sdn) |
| `get_node_status` | CPU, geheugen, swap, uptime, kernel- en PVE-versie van één node |

**VM's en containers**

| Tool | Doet |
|---|---|
| `list_vms` | QEMU-VM's op een node |
| `list_containers` | LXC-containers op een node |
| `get_guest_status` | Draaiend?, uptime, CPU-, geheugen- en disk-gebruik |
| `get_guest_config` | Cores, geheugen, disks, netwerkinterfaces, boot-opties |
| `list_snapshots` | Snapshots van één gast |
| `get_guest_rrddata` | Historische statistieken (`timeframe`: hour/day/week/month/year) |

**Storage, netwerk, taken**

| Tool | Doet |
|---|---|
| `list_storage` | Storages met type, capaciteit en vrije ruimte |
| `list_storage_content` | Inhoud van één storage (`content`: backup/images/iso/vztmpl/…) |
| `list_networks` | Interfaces en bridges van een node |
| `list_tasks` | Recente taken; `errors: true` toont alleen mislukte |
| `get_task_status` | Status van één taak via haar UPID |
| `get_task_log` | Logregels van één taak — de ingang bij een mislukte back-up of migratie |

Tools met een `node`-parameter mogen die weglaten: dan geldt `PROXMOX_NODE`, en als die leeg is en
het cluster telt precies één node, wordt die gekozen. Bij meerdere nodes zonder keuze volgt een
duidelijke fout in plaats van een gok.

## Foutmeldingen

- **401** — `PROXMOX_TOKEN_ID` of `PROXMOX_TOKEN_SECRET` klopt niet. Let op de vorm
  `gebruiker@realm!tokennaam`.
- **403** — het token mist rechten. Meestal ontbreekt de `pveum acl modify ... --token`-regel:
  met `--privsep 1` erft het token niet de rechten van de gebruiker.
- **Certificaatfouten** — de server valideert TLS. Draait Proxmox met een self-signed certificaat,
  gebruik dan een echt certificaat (reverse proxy of Proxmox' ACME-integratie) of vertrouw de CA
  via `NODE_EXTRA_CA_CERTS`.
