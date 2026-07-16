# CLAUDE.md — wetsanalyse-frontend

Next.js (App Router) + TypeScript-webapp bovenop de [wetsanalyse-API](../api). Ontsluit de hele
JAS-workflow in de browser: analyse aanmaken, live voortgang (SSE), de human-in-the-loop review-lus,
het eindrapport, de **RegelSpraak-formaliseringsfase** (starten + model bekijken/downloaden), en een
`/beheer`-scherm voor LLM-modelprofielen, de wet-catalogus en token-verbruik.
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
  spiegelt — verzin daar geen fasen bij; brongetrouw geldt ook in de UI). **De analyse-eenheid is
  het werkgebied met meerdere bronnen:** een analyse draagt `bronnen[]` (wet+artikel+lid),
  activiteit 2 rendert per bron, activiteit 3 is werkgebied-breed met cross-bron `vindplaatsen`.
  Het act-3-contract is **begrip-id-gebouwd** (`RegelUitvoer`/`RegelInvoer`/`RegelParameter`/
  `RegelVoorwaarde`, `BegripRelatie`/`BegripHerkomst`) en `StartRequest.begrippenlijst` draagt een
  optionele aangeleverde begrippenlijst (`BegripInvoer[]`).
  `lib/bronnen.ts` centraliseert de bron-labels, de `vindplaatsen`-weergave en de wet-afleiding;
  `lib/begrippen.ts` centraliseert de **begrip-graaf-weergave** (id→naam, herkomst-label,
  regelvelden als begripnamen) voor `ReviewPanel`/`RapportView`;
  het analyseformulier (`ProjectForm`/`lib/projectForm.ts`) heeft herhaalbare bron-rijen, een
  **artikel-combobox met autocomplete + lid-keuzelijst** (wetsstructuur via `lib/useWetStructuur.ts`
  + `lib/artikelFilter.ts` + `components/ui/Combobox.tsx`; degradeert naar vrije invoer als de
  lookup faalt) en een inklapbaar blok **"Bestaande begrippenlijst (optioneel)"** (plak/upload;
  client-side parser `parseBegrippenlijst` in `lib/projectForm.ts` — JSON, CSV met kopregel, of
  `naam; definitie`-regels).
- `app/**/page.tsx` (Server Components) — data ophalen via `lib/server.ts`; interactie delegeren naar
  een `*Client.tsx` Client Component (bv. `app/projecten/[id]/ProjectClient.tsx`). `app/page.tsx`
  (home) en `app/dashboard` renderen server-side de projectlijst en delegeren naar resp.
  `ProjectenLijstClient` en `DashboardClient` — beide live via `useProjectenStream` op de
  aggregate-route (tellers/functiefasen op het dashboard via `components/DashboardCard`). Beide
  delen de client-side **zoek-/filter-/sorteer-/pagineerlaag**: `lib/projectFilter.ts`
  (`filterEnSorteer`/`distinctWetten`/`paginate`) + `components/ProjectControls.tsx` +
  `components/Pagination.tsx`; statusgroepen via `statusBucket` in `lib/states.ts`.
- `components/` — presentatie; `components/admin/` is het `/beheer`-scherm (achter het admin-token):
  modelprofielen, wetten, gebruikers, token-verbruik én **`LlmCapturePanel`** (toggle voor het
  vastleggen van LLM-calls + viewer per analyse-id; BFF-routes `/api/admin/settings` en
  `/api/admin/projects/[id]/llm-calls`). `components/ui/` zijn de primitives. De **cross-referenties**
  (`Verwijzing`-type in `lib/types.ts`)
  renderen puur in `RapportView.tsx` (Verwijzingen-sectie) en `ReviewPanel.tsx` (scope-feedback per
  verwijzing, via het bestaande per-id-feedbackmechanisme) uit de bestaande `/rapport`- en
  `/ronde`-data — er is **geen nieuwe BFF-route** voor nodig.
- **Act2-only afronden + act3 on-demand.** `ReviewPanel.tsx` biedt bij activiteit 2 de knop
  **"Akkoord — afronden zonder act. 3"** (feedback-status `akkoord-afronden`; alleen geldig op
  activiteit 2 zonder opmerkingen — het API-contract valideert dat). De analyse krijgt dan
  `scope: "act2"` (`Scope`-type in `lib/types.ts`); `DashboardCard` past de stationsweergave
  daarop aan. Op zo'n act2-only rapport toont `ProjectClient.tsx` de knop **"Activiteit 3
  uitvoeren"** (`startAct3` in `lib/api.ts` → BFF-route `app/api/projects/[id]/act3/route.ts`),
  waarna de SSE-stream heropent.
- **RegelSpraak-vervolgfase.** Op een afgeronde analyse (`klaar`) toont `ProjectClient.tsx` een knop
  **"Naar RegelSpraak"** (`startRegelspraak`); daarna heropent het de SSE-stream (`streamGen`) omdat
  `klaar` terminaal is. De rs-states (`rs-gegevens-runt`/`wacht-op-review-rs-gegevens`/`rs-regels-runt`/
  `wacht-op-review-rs-regels`/`rs-bouwt`/`rs-klaar`) staan in `lib/states.ts` + `lib/fasen.ts`; de
  `reviewActiviteit`-helper mapt de rs-review-states op `rs-gegevens`/`rs-regels`, zodat `ReviewPanel.tsx`
  ze met hetzelfde feedbackmechanisme afhandelt. Bij `rs-klaar` toont `components/RegelspraakView.tsx`
  het model (GegevensSpraak + regels, met herkomst en `.rs`/`.md`-download). BFF-routes:
  `app/api/projects/[id]/regelspraak{,-rs,-md}/route.ts`. De RegelSpraak-modeltypes staan in
  `lib/types.ts` (`RegelspraakModel`, `GegevensSpraak`, …) — afgeleid van het API-contract.
- **Vormgeving (Rijkshuisstijl, Belastingdienst-stijlvak)** — alle design tokens centraal:
  CSS-variabelen in `app/globals.css` → Tailwind in `tailwind.config.ts` (lintblauw `#154273` +
  hemelblauw `#007bc7` op wit, Fira Sans/Mono als vrij alternatief voor Rijksoverheid Sans,
  responsive 100/90/80 via root-font-size). `components/ui/` zijn de primitives (48px-knoppen/velden,
  platte cards, gecentreerde logobalk met het officiële `public/belastingdienst-logo.svg`,
  `Vormelement`-signatuur). **Knoppen zijn mobile-first**: `Button`/`LinkButton` zijn bewust
  breedte-neutraal (`inline-flex shrink-0`); actie-rijen lopen via `components/ui/ButtonRow.tsx`
  (mobiel volle-breedte gestapeld, `sm:` naast elkaar). Staat een knop buiten een `ButtonRow`
  (bv. naast een invoerveld), geef hem dan `className="w-full sm:w-auto"` en laat de container op
  mobiel stapelen (`flex flex-col … sm:flex-row`) — geen vaste/`flex-wrap`-knoprijen die op smal
  scherm overlopen. De JAS-klassekleuren in `lib/jas.ts` zijn de **exacte labelkleuren uit
  `docs/wa-table.png`**; job-state-kleuren in `lib/states.ts`.

## Observability

`instrumentation.ts` registreert OpenTelemetry via `@vercel/otel` (gated op
`OTEL_EXPORTER_OTLP_ENDPOINT`; auto-tracing van route handlers + uitgaande `fetch` met
traceparent-propagatie → end-to-end trace over de chat-keten). `lib/logger.ts` is de **server-only**
gestructureerde JSON-logger (mirror van de MCP-logger: secret-redactie, `LOG_LEVEL`, `trace_id`/
`span_id`), ingezet in de BFF-lagen (`app/api/_lib/proxy.ts`, `lib/server.ts`, de chat-route). Nooit
importeren vanuit een Client Component (net als `lib/config.ts`/`lib/server.ts`), en nooit
tokens/secrets/inhoud loggen. In de vitest-node-omgeving wordt `server-only` gestubd
(`vitest.config.ts` → `test/stub-empty.ts`). Zie `docs/observability.md`.

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
  zit server-side in de BFF. Meng de twee tokens niet.
- **Login = Auth.js (NextAuth v5), API is identiteitsbron.** De hele app zit achter een login met
  **userid** + wachtwoord (`auth.ts` + `auth.config.ts`; `proxy.ts` — de Next 16-opvolger van
  de `middleware`-conventie — bewaakt élke route en
  stuurt niet-ingelogden naar `/login`). Inloggen gaat uitsluitend met de userid; e-mail wordt bij
  het aanmaken verplicht/uniek geregistreerd maar is geen inlog-identiteit. De sessie is een
  httpOnly JWT-cookie (`AUTH_SECRET`) die de `userid` + rol draagt; de Credentials-provider
  verifieert server→server bij de API (`lib/server.ts → verifyCredentials` → `/v1/auth/verify`). De
  **API blijft de identiteitsbron** (users-tabel met `userid` als sleutel, wachtwoord-hash, TOTP);
  de BFF houdt alleen de sessie. Rollen: **`beheerder`** (mag `/beheer` + `/api/admin/*`) en
  **`analist`** (de rest) — afgedwongen in de `authorized`-callback én server-side in
  `app/beheer/page.tsx`. De eerste keer (lege users-tabel) maakt `/setup` eenmalig de eerste
  beheerder; daarna sluit die route. **Gebruikersbeheer** zit in `/beheer` (`UsersPanel`, achter het
  admin-token). **2FA (TOTP)** is optioneel en self-service in `/account`; verdere gebruikers maakt
  een beheerder aan met een eenmalig tijdelijk wachtwoord. De account/2fa-BFF-routes zetten de
  ingelogde identiteit als vertrouwde `X-User-Id`-header (uit de sessie, nooit uit browser-input).
  Let op: Auth.js' eigen routes leven onder `/api/auth/*` — daar geen eigen BFF-route bijzetten
  (de eenmalige-registratie-proxy staat daarom op `/api/setup`).
- **Sessie-revocatie + CSRF defense-in-depth.** De sessie is rollend met een **per-login duur**:
  `session.maxAge` = 30 dagen (`SESSIE_LANG`, de cookie-/bovengrens) + `updateAge` = 1 dag in
  `auth.config.ts`, maar de custom `jwt.encode` in `auth.ts` zet de effectieve JWT-`exp` op
  **30 dagen als "Ingelogd blijven op dit apparaat" is gekozen** (`token.rememberMe`), anders
  **12 uur** (`SESSIE_KORT`). Die keuze is één checkbox op `/login` (default uit), die óók de
  trusted-device-cookie stuurt (2FA overslaan) — op het 2FA-scherm is er dus geen aparte checkbox
  meer; de keuze reist via `sessionStorage` (`wa_login_remember`) mee naar `/login/2fa`. De
  node-`jwt`-callback in `auth.ts` herverifieert elke ~5 min de accountstatus bij de API
  (`lib/server.ts → getAccountStatus` → `/v1/auth/me`): een gedeactiveerd account invalideert de
  sessie, een rolwijziging werkt direct door in het token. De edge-middleware draait de lichte
  `jwt`-variant zonder herverificatie (`lib/server.ts` is node-only) — elke `auth()`-aanroep in
  Server Components/route handlers loopt wél langs de herverifiërende versie, en de ~5-min
  herverificatie (niet de lange `maxAge`) is de feitelijke revocatie-grens. Daarnaast
  handhaaft de `authorized`-callback een **Origin-check** op muterende BFF-calls
  (`POST/PUT/PATCH/DELETE` op `/api/*`, incl. de publieke `/api/login-verify`): een meegestuurde
  vreemde Origin → 403; zonder Origin-header valt het terug op `SameSite=Lax`. De cookie-flags
  (`httpOnly`/`sameSite=lax`/`secure`) staan expliciet in `authConfig` vastgelegd.
- **Geen vrije model-string of dwingende wet-lijst in de UI.** Het modelprofiel kies je uit de live
  `/api/profiles`-dropdown; de wet-dropdown (`/api/wetten`) is een gemak — is de catalogus leeg, dan
  val je terug op vrije BWB-id-invoer. Hetzelfde geldt voor de artikel-autocomplete en lid-keuze
  (`/api/wetten/[bwbId]/structuur` en `/api/wetten/[bwbId]/artikelen/[artikel]`): faalt de
  structuur-lookup, dan degradeert de rij naar vrije tekstvelden. De API blijft elke geldige
  BWB-id accepteren.
- **Huisstijl via tokens, niet hardcoded.** Kleur en typografie lopen via de tokens in
  `app/globals.css` + `tailwind.config.ts` (en `lib/jas.ts`/`lib/states.ts` voor de badges) — strooi
  geen losse hex-waarden door componenten. Het officiële logo-asset (`public/belastingdienst-logo.svg`)
  blijft ongewijzigd; de JAS-klassekleuren komen exact uit `docs/wa-table.png`.

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
