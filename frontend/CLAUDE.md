# CLAUDE.md — wetsanalyse-frontend

Next.js (App Router) + TypeScript-webapp bovenop de [wetsanalyse-API](../api). Ontsluit de hele
JAS-workflow in de browser: analyse aanmaken, live voortgang (SSE), de human-in-the-loop review-lus,
het eindrapport, en een `/beheer`-scherm voor LLM-modelprofielen, de wet-catalogus en token-verbruik.
Lees ook de projectroot-`CLAUDE.md` en `../api/CLAUDE.md` — de API is de bron van waarheid voor de
datacontracten en de state machine; deze app is een **dunne, server-getokende schil** eroverheen.
Operationele details (lokaal draaien, env-vars, deployment) staan in de `README.md`; dit bestand
beschrijft de architectuurregels die je bij code-werk *in* de frontend niet mag breken.

## Dragend principe — BFF, token blijft server-side

De browser praat **uitsluitend** met de eigen Next.js-origin (`/api/**`). De Route Handlers (de
_backend-for-frontend_) proxyen server-side naar de echte API en injecteren het Bearer-token. Het
token komt dus **nooit** in de browser. Dit lost twee dingen tegelijk op: CORS vervalt (same-origin)
en SSE werkt (de native `EventSource` kan geen `Authorization`-header sturen — de BFF doet dat
server-side en pipet de stream door).

```
Browser ──/api/**──► Next.js (BFF, injecteert token) ──/v1/**──► wetsanalyse-api:3000
```

De **harde scheidingslijn**: alles met een token is server-only.

- `lib/config.ts` (token uit env/`*_FILE`, gecached) en `lib/server.ts` (server→server fetch voor de
  initiële render van Server Components) zijn server-only en mogen **nooit** vanuit een Client
  Component geïmporteerd worden. Doe je dat wel, dan lekt het token naar de bundel.
- Client Components praten alleen via `lib/api.ts` met de eigen `/api/**`-routes — **geen
  Authorization-header** daar.

## Lagen (waar hoort wat)

- `app/api/_lib/proxy.ts` — de kern van de BFF: één `proxy(path, init)`-helper die de upstream-status
  en -body **ongewijzigd** teruggeeft (incl. 401/404/409/429/503 + `Retry-After`/`Location`/
  `Content-Type`-headers), zodat de client correcte foutafhandeling houdt. `init.admin: true`
  injecteert het admin-token i.p.v. het client-token. `Location` wordt herschreven van
  `/v1/projects/{id}` naar de eigen `/api/projects/{id}`-route. Verzin in nieuwe routes geen eigen
  fetch-logica — leid alles via deze helper.
- `app/api/projects/[id]/events/route.ts` + `app/api/projects/events/route.ts` — de twee
  **uitzonderingen**: SSE-passthrough (geen `proxy()`), pipen `upstream.body` rauw door met
  `X-Accel-Buffering: no` en `Cache-Control: no-transform`. De eerste is de per-project-stream
  (projectdetail); de tweede is de **aggregate-stream** over álle analyses van de client die zowel
  `/dashboard` als de projectenlijst (`/`) live houdt (upstream `GET /v1/projects/events`). Beide
  worden via de gedeelde hook `lib/useProjectenStream.ts` geconsumeerd. Bij wijzigen niet bufferen —
  dat breekt de live voortgang (en NPM moet proxy-buffering ook uit hebben).
- `lib/server.ts` — server-side GET-helpers voor Server Components (rechtstreeks server→server, scheelt
  een extra self-fetch via de BFF bij de eerste render).
- `lib/api.ts` — alle client-side fetch-helpers naar `/api/**`. Eén plek voor het foutcontract
  (`parseError` → `ApiError` met `retryAfter`); gebruik `isApiError()` in de UI.
- `lib/types.ts` — **met de hand afgeleid van `../api/app/contracts.py`** en de bron-van-waarheid voor
  de TS-kant. Wijzigt het API-contract, werk dit bestand bij (verifieer desgewenst tegen
  `openapi-typescript http://localhost:3000/openapi.json` — zie de README). `lib/states.ts` /
  `lib/jas.ts` / `lib/fasen.ts` zijn afgeleide presentatie-helpers (macro-statuslabels,
  JAS-klasse-weergave, en het fijnmazige **fase**-vocabulaire dat 1-op-1 de orchestrator-fasen
  spiegelt — verzin daar geen fasen bij; brongetrouw geldt ook in de UI).
- `app/**/page.tsx` (Server Components) — data ophalen via `lib/server.ts`; interactie delegeren naar
  een `*Client.tsx` Client Component (bv. `app/projecten/[id]/ProjectClient.tsx`). `app/page.tsx`
  (home) en `app/dashboard` renderen server-side de projectlijst en delegeren naar resp.
  `ProjectenLijstClient` en `DashboardClient` — beide live via `useProjectenStream` op de
  aggregate-route (tellers/functiefasen op het dashboard via `components/DashboardCard`).
- `components/` — presentatie; `components/admin/` is het `/beheer`-scherm (achter het admin-token),
  `components/ui/` zijn de primitives. De **cross-referenties** (`Verwijzing`-type in `lib/types.ts`)
  renderen puur in `RapportView.tsx` (Verwijzingen-sectie) en `ReviewPanel.tsx` (scope-feedback per
  verwijzing, via het bestaande per-id-feedbackmechanisme) uit de bestaande `/rapport`- en
  `/ronde`-data — er is **geen nieuwe BFF-route** voor nodig.

## Regels (niet aan tornen)

- **Token nooit naar de client.** Geen import van `lib/config.ts`/`lib/server.ts` in Client
  Components; geen token in `NEXT_PUBLIC_*`. Nieuwe upstream-calls lopen via een Route Handler.
- **Geen onbetrouwde waarde rechtstreeks in een `href`.** Velden uit de analyse-pipeline/LLM
  (`bronreferentie`, `verwijzing.doel.target`) kunnen een `javascript:`/`data:`-scheme bevatten —
  React escaped tekst, maar niet de href-scheme. Route ze altijd via `bronHref`/`wettenOverheidHref`
  in `lib/url.ts` (jci-uri → wetten.overheid.nl-deeplink; onbetrouwd schema → platte tekst).
- **Status/headers ongewijzigd doorgeven.** De API bezit het gedrag (409 bij verkeerde state, 429 +
  `Retry-After`, 404 op andermans id). De BFF maskeert dat niet; de UI reageert erop.
- **Admin-pad apart.** `/api/admin/*` → `proxy(..., { admin: true })` → `/v1/admin/*`. Het admin-token
  zit server-side in de BFF; er is **geen** apart inlogscherm — afscherming van `/beheer` gebeurt
  buiten de app (NPM Access List; OIDC staat op de roadmap). Meng de twee tokens niet.
- **Geen vrije model-string of dwingende wet-lijst in de UI.** Het modelprofiel kies je uit de live
  `/api/profiles`-dropdown; de wet-dropdown (`/api/wetten`) is een gemak — is de catalogus leeg, dan
  val je terug op vrije BWB-id-invoer. De API blijft elke geldige BWB-id accepteren.

## Commando's

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000 (draait API óók op 3000? → npm run dev -- -p 3001)
npm run build        # productiebuild (output: 'standalone')
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

Vereist een draaiende API (lokaal of het publieke domein) + de env-vars uit `.env.local`
(`API_BASE_URL`, `API_TOKEN`, `ADMIN_API_TOKEN`; zie README). Draai `npm run lint && npm run
typecheck` vóór een commit.
