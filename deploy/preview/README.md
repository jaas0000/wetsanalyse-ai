# Per-PR preview-omgevingen (Portainer, ephemeer)

Elke **pull request** krijgt automatisch een **geïsoleerde full-stack** (postgres + api + graph-qa +
frontend) op de NAS, bereikbaar op `https://pr<N>.preview.ipalm.nl`. Bij het **sluiten** van de PR wordt
alles weer opgeruimd. Verse database per PR; productie blijft ongemoeid. Draait op de eigen NAS — **geen
cloudkosten**.

- Workflow: `.github/workflows/preview.yml` (build → deploy → teardown).
- Stack-definitie: `deploy/preview/docker-compose.yml` (config volledig via **env-vars**, geen
  host-secret-bestanden — api/graph-qa lezen elk secret ook uit platte env).
- Helpers: `pr-comment.sh` (één bewerkbare PR-comment), `npm-host.sh` (optionele NPM-proxyhost).

> **Alleen same-repo PR's.** Forks krijgen geen secrets → geen preview (`head.repo == github.repository`).

## Hoe het werkt

1. **build** — bouwt de 3 images van de PR-head en pusht ze naar GHCR met tag **`pr-<N>`**.
2. **deploy** — genereert **deterministische** per-PR-secrets (HMAC van `PREVIEW_SECRET_SEED` + PR-nummer;
   stabiel over re-deploys, zodat het postgres-volume-wachtwoord niet verspringt), en zet de stack
   `preview-pr-<N>` neer via de **Portainer-API** (aanmaken of updaten). Daarna (optioneel) een
   NPM-proxyhost, en een **PR-comment** met de URL.
3. **teardown** (PR closed) — verwijdert de Portainer-stack **inclusief volume** en de NPM-host, en werkt
   de PR-comment bij.

Isolatie komt van de stacknaam `preview-pr-<N>` (= compose-projectnaam) + expliciete `container_name`s
(`preview-pr-<N>-postgres` etc.), dus twee PR's botsen nooit. De **kennisgraaf** (GraphDB-MCP) en de
**LLM** zijn gedeelde, externe diensten.

## Eenmalige setup

### GitHub — secrets & variables
Bestaand (hergebruikt): `secrets.PORTAINER_URL`, `secrets.PORTAINER_API_KEY`, `secrets.GRAPHDB_TOKEN`,
`secrets.AZURE_AI_KEY`, `vars.LLM_API_BASE`.

Nieuw:
| naam | type | doel |
|---|---|---|
| `PREVIEW_SECRET_SEED` | secret | seed voor de deterministische per-PR-secrets (`openssl rand -hex 32`) |
| `PORTAINER_ENDPOINT_ID` | var | Portainer-endpoint (default `1`) |
| `PROXY_NETWORK` | var | gedeeld netwerk (default `homeinfra_internal`) |
| `PREVIEW_BASE_DOMAIN` | var | basisdomein (default `preview.ipalm.nl`) |
| `LLM_MODEL` / `GRAPHDB_MCP_URL` / `GRAPH_QA_SIMILARITY_INDEX` | var | optioneel (hebben defaults) |
| `NPM_URL` + `secrets.NPM_IDENTITY`/`secrets.NPM_SECRET` + `NPM_CERT_ID` | var/secret | **optioneel** — NPM-host-automatisering |

### DNS + TLS (eenmalig)
Wildcard `*.preview.ipalm.nl` → de NAS, en in nginx-proxy-manager een **wildcard-certificaat** voor
`*.preview.ipalm.nl` (noteer het `certificate_id` → `vars.NPM_CERT_ID`). https is nodig omdat Auth.js
`secure`-cookies zet (over http breekt de login).

### NPM-host: automatisch of handmatig
- **Automatisch** (aanbevolen): zet `NPM_URL`/`NPM_IDENTITY`/`NPM_SECRET`/`NPM_CERT_ID`. `npm-host.sh`
  maakt/verwijdert per PR de proxyhost `pr<N>.preview.ipalm.nl` → `preview-pr-<N>-frontend:3000`
  (met `proxy_buffering off;` voor de SSE-stream). *De NPM-API varieert licht per versie — verifieer de
  eerste run.*
- **Handmatig** (fallback): laat de NPM-vars leeg; maak per PR zelf een proxyhost naar
  `preview-pr-<N>-frontend:3000`.

## Eerste gebruik / validatie

De Portainer-/NPM-API-calls konden **niet vanuit de dev-omgeving getest worden** (egress-policy blokkeert
`portainer.ipalm.nl`); de **eerste PR is de live-validatie** op de GitHub-runner. Verwacht:
1. 3 `pr-<N>`-images in GHCR.
2. Stack `preview-pr-<N>` draait in Portainer (4 containers healthy).
3. `https://pr<N>.preview.ipalm.nl/setup` → maak de eerste beheerder (verse, lege DB).
4. Een vraag + een annotatie in `/workbench` werkt; gesprek + geheugen blijven binnen de env.
5. PR sluiten → stack + volume + NPM-host weg; de PR-comment zegt "opgeruimd".

Gaat stap 2 mis, kijk dan naar de Portainer-versie: de create-call gebruikt
`POST /api/stacks/create/standalone/string` (Portainer ≥ 2.19). Op oudere versies is dat
`POST /api/stacks?type=2&method=string&endpointId=<id>` — pas dan `preview.yml` aan.

## Azure (geparkeerd)
De Azure-variant (per-PR resource group via de al-prefixbare Bicep) is bewust uitgesteld; later op
dezelfde `preview.yml` bij te prikken.
