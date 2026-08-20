# Dev-omgeving — https://dev.wetsanalyse.ipalm.nl

Eén vaste, gedeelde omgeving (postgres + api + graph-qa + frontend) naast productie, met een **eigen
database**. Bedoeld om een branch echt te kunnen gebruiken voordat hij naar master gaat.

- Workflow: `.github/workflows/dev-deploy.yml` — **handmatig starten** (Actions → *dev-deploy* → *Run
  workflow* → kies de branch). Zo bepaal jij wat er op dev staat; een merge naar master overschrijft
  het niet stilzwijgend.
- Stack-definitie: `deploy/dev/docker-compose.yml` (config volledig via **env-vars**, geen
  host-secret-bestanden — api/graph-qa lezen elk secret ook uit platte env).
- Helper: `npm-host.sh` (optionele NPM-proxyhost).
- Afbreken: dezelfde workflow met **`destroy: true`** — stack, database én proxyhost gaan weg.

## Waar het draait

| onderdeel | plek |
|---|---|
| Portainer | `portainer.ipalm.nl` = `192.168.10.23:9443`, **endpoint-id 3** (de enige; `1` bestaat niet) |
| Docker-host | Proxmox-LXC **103** (`docker`) — draait verder alleen `ntfy`, `portainer`, `watchtower` |
| nginx-proxy-manager | Proxmox-LXC **101** — een **andere** LXC |
| Kennisgraaf (GraphDB-MCP) + LLM | externe, gedeelde diensten |

Omdat NPM op een andere LXC draait, delen ze geen docker-netwerk: proxyen op containernaam kan niet.
Daarom publiceert alleen de frontend een hostpoort (**8090**, vrij naast ntfy's 8080 en Portainers
8000/9443) en stuurt NPM `dev.wetsanalyse.ipalm.nl` door naar `192.168.10.23:8090`. De overige
containers blijven op het interne netwerk.

> ⚠️ **Ruimte op LXC 103.** De LXC heeft **2 GB RAM** en een rootfs van 4 GB waarvan **~2,2 GB vrij**.
> De vier images samen (postgres 17, api, frontend, graph-qa) halen dat niet met marge. Vergroot de
> LXC vóór de eerste deploy, bijvoorbeeld: `pct resize 103 rootfs +16G` op `pve01`, en overweeg
> `pct set 103 -memory 4096`. Zonder die ruimte faalt de deploy op een image-pull.

## Eenmalige setup

### GitHub — secrets & variables
Bestaand (hergebruikt): `secrets.PORTAINER_URL`, `secrets.PORTAINER_API_KEY`, `secrets.GRAPHDB_TOKEN`,
`secrets.AZURE_AI_KEY`, `vars.LLM_API_BASE`, `vars.LLM_MODEL`.

| naam | type | status | doel |
|---|---|---|---|
| `PREVIEW_SECRET_SEED` | secret | ✅ gezet | seed voor de deterministische dev-secrets (`openssl rand -hex 32`) |
| `PORTAINER_URL` | secret | ✅ gezet | `https://portainer.ipalm.nl` (endpoint 3). Een stack-id uit een andere Portainer-instantie geeft hier **HTTP 403** — de stack bestaat dan niet. |
| `DEV_PORTAINER_ENDPOINT_ID` | var | niet nodig | default `3` — geverifieerd |
| `DEV_HOSTNAME` | var | niet nodig | default `dev.wetsanalyse.ipalm.nl` |
| `DEV_HOST_PORT` / `DEV_FORWARD_HOST` | var | niet nodig | defaults `8090` / `192.168.10.23` |
| `GRAPHDB_MCP_URL` / `GRAPH_QA_SIMILARITY_INDEX` | var | niet nodig | defaults gelijk aan de graph-qa-productiestack |
| `NPM_URL` + `secrets.NPM_IDENTITY`/`secrets.NPM_SECRET` + `NPM_CERT_ID` | var/secret | ⬜ open | **optioneel** — NPM-host-automatisering; zonder deze vier maak je de proxyhost handmatig |

De preflight-stap faalt met een duidelijke melding als een verplichte waarde ontbreekt.

### DNS + TLS
`dev.wetsanalyse.ipalm.nl` → hetzelfde publieke IP als de andere hosts, en in nginx-proxy-manager een
certificaat voor die naam (noteer het `certificate_id` → `vars.NPM_CERT_ID`). https is nodig omdat
Auth.js `secure`-cookies zet; over http breekt de login.

### NPM-host: automatisch of handmatig
- **Automatisch** (aanbevolen): zet `NPM_URL`/`NPM_IDENTITY`/`NPM_SECRET`/`NPM_CERT_ID`. `npm-host.sh`
  maakt/verwijdert de proxyhost `dev.wetsanalyse.ipalm.nl` → `192.168.10.23:8090` (met
  `proxy_buffering off;` voor de SSE-stream). *De NPM-API varieert per versie — verifieer de eerste run.*
- **Handmatig** (fallback): laat de NPM-vars leeg en maak zelf een proxyhost naar `192.168.10.23:8090`.

## Eerste run / validatie

De schrijvende Portainer-/NPM-calls zijn niet lokaal te testen; de eerste run is de live-validatie.
Verwacht:

1. 3 images met tag `dev` in GHCR.
2. Stack `wetsanalyse-dev` draait op endpoint 3 (4 containers) — de workflow wacht daarop en faalt
   als er één ontbreekt.
3. `https://dev.wetsanalyse.ipalm.nl/setup` → maak de eerste beheerder (verse, lege DB).
4. Een vraag + een annotatie in `/workbench` werkt.
5. `destroy: true` → stack, volume en NPM-host weg.

Gaat stap 2 mis op een oudere Portainer, dan is de create-call
`POST /api/stacks?type=2&method=string&endpointId=<id>` in plaats van
`POST /api/stacks/create/standalone/string` (die vereist ≥ 2.19; hier draait 2.39.5).

## GHCR-retentie
`ghcr-cleanup.yml` ontziet de `dev`-tag (`exclude-tags: latest,dev`), anders zou de retentie na een
productie-build de image onder de draaiende dev-stack vandaan halen.
