# Wetsanalyse-frontend

Next.js (App Router) + TypeScript-frontend voor de [Wetsanalyse-API](../api). Ontsluit de hele
JAS-workflow in de browser: analyse aanmaken, live voortgang, de human-in-the-loop review-lus en
het eindrapport.

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
| `API_BASE_URL`   | `http://wetsanalyse-api:3000` | Server-side adres van de API (intern in productie).         |
| `API_TOKEN`      | —                             | Bearer-token (server-side). Komt nooit in de browser.       |
| `API_TOKEN_FILE` | —                             | Pad naar secret-bestand met het token (heeft voorrang).     |

## Docker / deployment

Multi-stage `Dockerfile` (standalone, non-root) + `docker-compose.yml` voor de Portainer-stack
achter Nginx Proxy Manager, identiek aan de API/MCP-stijl. CI:
`.github/workflows/frontend-docker-publish.yml` (test → build → GHCR → Trivy → Portainer-redeploy).

Eénmalig op de host (in `SECRETS_DIR`, gedeeld met de API-stack): een bestand
`frontend_api_token` met een geldige tokenwaarde uit de API-tokenlijst (mode 644). In NPM een
Proxy Host `wetsanalyse.ipalm.nl` → `wetsanalyse-frontend:3000`, met **proxy buffering uit** voor
SSE (zie de commentaarregels in `docker-compose.yml`).

## Types up-to-date houden (optioneel)

`lib/types.ts` is met de hand afgeleid van `api/app/contracts.py` en is de bron-van-waarheid. Wil
je tegen het live OpenAPI-schema controleren:

```bash
npx openapi-typescript http://localhost:3000/openapi.json -o lib/openapi.d.ts
```

Vergelijk dat met `lib/types.ts` bij contractwijzigingen.
