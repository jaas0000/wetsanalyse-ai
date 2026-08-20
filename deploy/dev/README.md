# Dev-omgeving

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

Deze repo is publiek en noemt daarom geen hostnamen, IP's of endpoint-nummers: die staan in de
repo-variabelen (zie de tabel hieronder). Wat de omgeving *nodig* heeft, staat hier wel.

| onderdeel | rol |
|---|---|
| Portainer | beheert de docker-host; het endpoint-nummer komt uit `DEV_PORTAINER_ENDPOINT_ID` |
| Docker-host | draait de dev-stack; hoeft verder niets te draaien |
| nginx-proxy-manager | terminatie van https, draait **buiten** de docker-host |
| Kennisgraaf (GraphDB-MCP) + LLM | externe, gedeelde diensten |

Omdat NPM elders draait, deelt hij geen docker-netwerk met de stack: proxyen op containernaam kan
niet. Daarom publiceert alleen de frontend een hostpoort (**8090**) en stuurt NPM de dev-hostnaam
door naar `<docker-host>:8090`. De overige containers blijven op het interne netwerk.

> ⚠️ **Ruimte op de docker-host.** De vier images samen (postgres 17, api, frontend, graph-qa) vragen
> ruim meer dan 2 GB schijf en zijn krap in 2 GB RAM. Controleer vóór de eerste deploy dat er marge
> is; zonder die ruimte faalt de deploy op een image-pull. (Dat is hier één keer echt misgegaan.)

## Eenmalige setup

### GitHub — secrets & variables
Bestaand (hergebruikt): `secrets.PORTAINER_URL`, `secrets.PORTAINER_API_KEY`, `secrets.GRAPHDB_TOKEN`,
`secrets.AZURE_AI_KEY`, `vars.LLM_API_BASE`, `vars.LLM_MODEL`.

| naam | type | status | doel |
|---|---|---|---|
| `PREVIEW_SECRET_SEED` | secret | ✅ gezet | seed voor de deterministische dev-secrets (`openssl rand -hex 32`) |
| `PORTAINER_URL` | secret | ✅ gezet | basis-URL van je Portainer. Een stack-id uit een *andere* Portainer-instantie geeft **HTTP 403** — de stack bestaat daar dan niet. |
| `DEV_PORTAINER_ENDPOINT_ID` | var | **verplicht** | het Portainer-endpoint van de docker-host |
| `DEV_HOSTNAME` | var | **verplicht** | publieke hostnaam van dev |
| `DEV_FORWARD_HOST` | var | **verplicht** | IP van de docker-host waar NPM naartoe forwardt |
| `DEV_HOST_PORT` | var | niet nodig | default `8090` (geen identifier, dus een default mag) |
| `GRAPHDB_MCP_URL` | var | **verplicht** | de graaf-MCP; graph-qa weigert te starten zonder |
| `GRAPH_QA_SIMILARITY_INDEX` | var | niet nodig | leeg = semantic_search uit |
| `NPM_URL` + `secrets.NPM_IDENTITY`/`secrets.NPM_SECRET` + `NPM_CERT_ID` | var/secret | ⬜ open | **optioneel** — NPM-host-automatisering; zonder deze vier maak je de proxyhost handmatig |

De preflight-stap faalt met een duidelijke melding als een verplichte waarde ontbreekt.

### DNS + TLS
Laat `DEV_HOSTNAME` naar hetzelfde publieke IP wijzen als je andere hosts, en maak in
nginx-proxy-manager een certificaat voor die naam (noteer het `certificate_id` → `vars.NPM_CERT_ID`). https is nodig omdat
Auth.js `secure`-cookies zet; over http breekt de login.

### NPM-host: automatisch of handmatig
- **Automatisch** (aanbevolen): zet `NPM_URL`/`NPM_IDENTITY`/`NPM_SECRET`/`NPM_CERT_ID`. `npm-host.sh`
  maakt/verwijdert de proxyhost `$DEV_HOSTNAME` → `$DEV_FORWARD_HOST:$DEV_HOST_PORT` (met
  `proxy_buffering off;` voor de SSE-stream). *De NPM-API varieert per versie — verifieer de eerste run.*
- **Handmatig** (fallback): laat de NPM-vars leeg en maak zelf een proxyhost naar dezelfde host/poort.

## Eerste run / validatie

De schrijvende Portainer-/NPM-calls zijn niet lokaal te testen; de eerste run is de live-validatie.
Verwacht:

1. 3 images met tag `dev` in GHCR.
2. Stack `wetsanalyse-dev` draait op het ingestelde endpoint (4 containers) — de workflow wacht daarop en faalt
   als er één ontbreekt.
3. `https://<DEV_HOSTNAME>/setup` → maak de eerste beheerder (verse, lege DB).
4. Een vraag + een annotatie in `/workbench` werkt.
5. `destroy: true` → stack, volume en NPM-host weg.

Gaat stap 2 mis op een oudere Portainer, dan is de create-call
`POST /api/stacks?type=2&method=string&endpointId=<id>` in plaats van
`POST /api/stacks/create/standalone/string` (die vereist ≥ 2.19; hier draait 2.39.5).

## GHCR-retentie
`ghcr-cleanup.yml` ontziet de `dev`-tag (`exclude-tags: latest,dev`), anders zou de retentie na een
productie-build de image onder de draaiende dev-stack vandaan halen.
