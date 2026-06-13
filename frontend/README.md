# Wetsanalyse-frontend

Next.js (App Router) + TypeScript-frontend voor de [Wetsanalyse-API](../api). Ontsluit de hele
JAS-workflow in de browser: analyse aanmaken, live voortgang, de human-in-the-loop review-lus en
het eindrapport.

Daarnaast een **`/beheer`-scherm** voor het LLM-beheer: de modelprofielen die de analyses aansturen
(toevoegen/bewerken/verwijderen, default kiezen, verbinding testen) en een overzicht van het
token-verbruik. Bij **Nieuwe analyse** kies je het profiel uit een dropdown die de profielen live
ophaalt, zodat wijzigingen in de draaiende app direct meekomen. Het beheer loopt via aparte
`/api/admin/*`-routes met een **apart admin-token** (zie hieronder).

## Architectuur — BFF met server-side token

De browser praat **uitsluitend** met de eigen Next.js-origin (`/api/**`). Die Route Handlers
(de _backend-for-frontend_) proxyen server-side naar de echte API en injecteren het Bearer-token.
Het token komt dus **nooit** in de browser. Dit lost ook twee dingen op: CORS vervalt (same-origin)
en Server-Sent Events werken (de native `EventSource` kan geen `Authorization`-header sturen — de
BFF doet dat server-side en pipet de stream door).

```
Browser ──/api/**──► Next.js (BFF, injecteert token) ──/v1/**──► wetsanalyse-api:3000
```

## Lokaal draaien

Vereist een draaiende API (zie [`../api/CLAUDE.md`](../api/CLAUDE.md)) — lokaal of het publieke
domein.

```bash
cd frontend
cp .env.example .env.local      # vul API_BASE_URL en API_TOKEN
npm install
npm run dev                     # http://localhost:3000
```

`.env.local`:

```
API_BASE_URL=http://localhost:3000      # of https://wetsanalyse-api.ipalm.nl
API_TOKEN=<alleen-de-tokenwaarde>       # het deel NA de ":" uit de API-tokenlijst
ADMIN_API_TOKEN=<alleen-de-tokenwaarde> # idem, maar uit de ADMIN-tokenlijst (voor /beheer)
```

> Draait de lokale API óók op poort 3000? Start de frontend dan op een andere poort:
> `npm run dev -- -p 3001`.

## Scripts

| Commando            | Doel                                         |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Dev-server (hot reload)                       |
| `npm run build`     | Productiebuild (`output: 'standalone'`)       |
| `npm start`         | Productieserver (na build)                    |
| `npm run lint`      | ESLint                                        |
| `npm run typecheck` | `tsc --noEmit`                                |

## Omgevingsvariabelen

| Variabele        | Default                       | Beschrijving                                                |
| ---------------- | ----------------------------- | ---------------------------------------------------------- |
| `API_BASE_URL`         | `http://wetsanalyse-api:3000` | Server-side adres van de API (intern in productie).            |
| `API_TOKEN`            | —                             | Bearer-token (server-side). Komt nooit in de browser.          |
| `API_TOKEN_FILE`       | —                             | Pad naar secret-bestand met het token (heeft voorrang).        |
| `ADMIN_API_TOKEN`      | —                             | Admin-bearer voor `/beheer` → `/v1/admin/*` (server-side).     |
| `ADMIN_API_TOKEN_FILE` | —                             | Pad naar secret-bestand met het admin-token (heeft voorrang).  |

## Docker / deployment

Multi-stage `Dockerfile` (standalone, non-root) + `docker-compose.yml` voor de Portainer-stack
achter Nginx Proxy Manager, identiek aan de API/MCP-stijl. CI:
`.github/workflows/frontend-docker-publish.yml` (test → build → GHCR → Trivy → Portainer-redeploy).

Eénmalig op de host (in `SECRETS_DIR`, gedeeld met de API-stack), beide mode 644:
`frontend_api_token` met een tokenwaarde uit de API-tokenlijst, en `frontend_admin_token` met een
tokenwaarde uit de **admin**-tokenlijst (voor `/beheer`). In NPM een Proxy Host
`wetsanalyse.ipalm.nl` → `wetsanalyse-frontend:3000`, met **proxy buffering uit** voor SSE (zie de
commentaarregels in `docker-compose.yml`).

> **Toegang tot `/beheer`.** Het admin-token zit server-side in de BFF; de browser ziet het niet en
> er is geen apart inlogscherm. Wie de frontend-URL kan bereiken, kan dus het LLM-beheer gebruiken.
> Wil je dat afschermen, zet dan een NPM **Access List (basic auth)** op de `/beheer`-route (OIDC +
> per-gebruiker toegang staat op de roadmap).

## Types up-to-date houden (optioneel)

`lib/types.ts` is met de hand afgeleid van `api/app/contracts.py` en is de bron-van-waarheid. Wil
je tegen het live OpenAPI-schema controleren:

```bash
npx openapi-typescript http://localhost:3000/openapi.json -o lib/openapi.d.ts
```

Vergelijk dat met `lib/types.ts` bij contractwijzigingen.
