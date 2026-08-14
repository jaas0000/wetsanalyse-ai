# CLAUDE.md — wetsanalyse-frontend

Next.js (App Router) + TypeScript-webapp bovenop de graph-qa-agent (en, voor login/beheer, de
[wetsanalyse-API](../api)). De app **is de werkplek**: `/workbench` (de *Assistent-pagina*) — één
chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, live tegen graph-qa (§*Werkplek*). De
home (`/`) leidt daarheen door.

> **Scope: chat-werkruimte.** De app bestaat uit de werkplek, de login-flow en het
> instellingenvenster (account, berichten, en voor beheerders modelprofielen, gebruikers,
> API-tokens, berichtenbeheer en feedback). Analyses aanmaken/reviewen/rapporteren hoort niet tot
> de functionaliteit.

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
  injecteert het admin-token i.p.v. het client-token. Verzin in nieuwe routes geen eigen
  fetch-logica — leid alles via deze helper. De **SSE-uitzondering** is de werkplek-agent-route
  (`app/api/annotatie/agent/route.ts`): geen `proxy()`, maar rauwe passthrough van `upstream.body`
  met `X-Accel-Buffering: no` en `Cache-Control: no-transform` (NPM moet proxy-buffering óók uit
  hebben) — zie §*Werkplek*.
- `lib/server.ts` — server-side helpers voor Server Components / auth (rechtstreeks server→server,
  scheelt een extra self-fetch via de BFF bij de eerste render). Bevat de auth-verificatie
  (`verifyCredentials`/`getAccountStatus`/`getSetupStatus`) die de login-flow gebruikt.
- `lib/api.ts` — alle client-side fetch-helpers naar `/api/**`. Eén plek voor het foutcontract
  (`parseError` → `ApiError` met `retryAfter`); gebruik `isApiError()` in de UI.
- `lib/types.ts` — **met de hand afgeleid van `../api/app/annotatie_contracts.py`**
  (+ `gesprek_contracts.py`) en de bron-van-waarheid voor de TS-kant. Wijzigt het API-contract, werk dit bestand bij (verifieer
  desgewenst tegen `openapi-typescript http://localhost:3000/openapi.json` — zie de README).
  `lib/jas.ts` is de afgeleide presentatie-helper voor de JAS-klasse-weergave (kleur + label uit
  `docs/wetsanalyse/wa-table.png`); brongetrouw geldt ook in de UI — verzin er geen klassen bij.
- `app/**/page.tsx` (Server Components) — data ophalen via `lib/server.ts`; interactie delegeren naar
  een `*Client.tsx` Client Component. `app/page.tsx` (home) doet server-side een `redirect("/workbench")`.
  De werkplek zit in `app/workbench/page.tsx` en de auth-schermen in `app/login/*` + `app/setup` +
  `app/disclaimer`. Account en beheer leven in het **instellingenvenster**:
  `app/instellingen/[[...tab]]/page.tsx` als volle pagina, en `app/@modal/(.)instellingen/…` als
  intercepting route die hem als dialoog over de werkplek heen opent. `app/beheer` en `app/account`
  blijven bestaan als redirect naar de bijbehorende tab.
- `components/` — presentatie. `components/werkplek/` + `components/workbench/` = de chat-werkruimte
  (zie §*Werkplek*). `components/admin/` levert de beheertabs (achter het admin-token):
  **`ProfielenPanel`** met de modelprofiel-editor (`ProfileEditor`), **`UsersPanel`**
  (gebruikersbeheer), **`ApiTokensPanel`**, **`BerichtenBeheerPanel`** (+ `BerichtEditor`) en
  **`FeedbackLijstClient`**. `components/berichten/` heeft het leesbare archief. `components/account/` + `components/auth/` dragen de login/2fa/setup-flow.
  `components/instellingen/` is het instellingenvenster zelf (`InstellingenDialog` = de dialoogschil,
  `InstellingenInhoud` = de tabs; de tabdefinities en de pad-helpers staan in `lib/instellingen.ts`,
  bewust **géén** `"use client"`-module zodat Server Components ze mogen importeren).
  `components/ui/` zijn de primitives.
- **Vormgeving (Rijkshuisstijl, Belastingdienst-stijlvak)** — alle design tokens centraal:
  CSS-variabelen in `app/globals.css` → Tailwind in `tailwind.config.ts` (lintblauw `#154273` +
  hemelblauw `#007bc7` op wit, Fira Sans/Mono als vrij alternatief voor Rijksoverheid Sans).
  De root-font-size is overal 100%: schaal met de Tailwind-tekstklassen, niet met een globale
  krimp. `components/ui/` zijn de primitives (40px-knoppen/velden die onder de `coarse:`-variant
  — `@media (pointer: coarse)`, zie `tailwind.config.ts` — naar 48px groeien voor aanraakbediening,
  platte cards, gecentreerde logobalk met het officiële `public/belastingdienst-logo.svg`). **Knoppen zijn mobile-first**: `Button`/`LinkButton` zijn bewust
  breedte-neutraal (`inline-flex shrink-0`); actie-rijen lopen via `components/ui/ButtonRow.tsx`
  (mobiel volle-breedte gestapeld, `sm:` naast elkaar). Staat een knop buiten een `ButtonRow`
  (bv. naast een invoerveld), geef hem dan `className="w-full sm:w-auto"` en laat de container op
  mobiel stapelen (`flex flex-col … sm:flex-row`) — geen vaste/`flex-wrap`-knoprijen die op smal
  scherm overlopen. De JAS-klassekleuren in `lib/jas.ts` zijn de **exacte labelkleuren uit
  `docs/wetsanalyse/wa-table.png`**.

## Werkplek — de Assistent-pagina (`/workbench`)

De **Assistent-pagina** (`app/workbench/page.tsx`, titel "Assistent") → `components/werkplek/WorkbenchShell.tsx`:
een **volledige chat-app-shell** (Claude/ChatGPT-achtig, in Belastingdienst-huisstijl). Op de
**app-shell-paden** wijkt de globale chrome: `SiteHeader`, `AppMain` (vol-bleed `h-[100dvh]`) en
`SiteFooter` vragen alle drie `isAppShellPad(pathname)` uit `lib/appShell.ts` — dat dekt `/workbench`
**én** `/instellingen*`, want de intercepting route wijzigt de URL terwijl de werkplek eronder blijft
staan. Voeg je een app-shell-pad toe, doe dat daar; niet met een losse `pathname === …`-check. De shell is twee kolommen:
- **Links de sidebar** (`GesprekSidebar` + `GesprekLijst`): bovenin het Belastingdienst-logo, een
  "Nieuw gesprek"-knop, de **chatgeschiedenis** (per-gebruiker gepersisteerd), en onderin een
  **instellingen/gebruiker**-blok (Account/Beheer + uitloggen). Op `<lg` is dit een off-canvas drawer
  (mobiele topbar met hamburger; scrim/Escape/safe-area).
- **Rechts het chatvenster** (`WerkplekClient.tsx`): één gespreksvenster voor **vragen** (Q&A) én
  **JAS-annotatie**, beide als SSE tegen graph-qa's unified agent. De thread hydrateert uit het actieve
  gesprek en **persisteert elke beurt** naar de api (`/v1/gesprekken/*`); de shell remount het venster
  (via `key`) alleen bij echt van gesprek wisselen, niet wanneer een verse chat bij de eerste beurt zijn
  id krijgt (anders breekt de stream). De graph-qa `conversationId` (thread_id) = het `gesprekId`.
- De **annotatie-review** is een **artefact**: een annotatie-beurt toont een compacte chip in de thread
  die het **`ArtefactPaneel`** opent — een van rechts inschuivend paneel (mobiel bottom-sheet) met de
  annotatie-sub-UI uit `components/workbench/`: **`DocumentPaneel`** highlight de **letterlijke**
  fragmenten (`segmenteer` + `lib/jas.ts:jasStyle`; substring-terugvinden) en **`ReviewQueue`** de
  decision-cards (aandacht-as 🟢🟡🔴, voortgangsteller; edit/reject vragen een `review_reason`).
- **Drie backends, frontend orkestreert:** de **chatgeschiedenis via de api** — BFF
  `app/api/gesprekken/*` → `/v1/gesprekken/*` via `proxy()`, mét de vertrouwde `X-User-Id` uit de sessie
  (client-helpers `lijstGesprekken`/`maakGesprek`/`haalGesprek`/`voegBerichtToe`/`hernoemGesprek`/
  `verwijderGesprek`). **Twee stores op dezelfde `conversation_id`**: de UI-historie staat in de API, het
  **agent-geheugen** in graph-qa's checkpointer — `verwijderGesprek` wist béíde (de BFF-DELETE roept ná de
  API-delete óók graph-qa `DELETE /v1/conversations/{id}` aan, best-effort). Het **live agent-verkeer via graph-qa** — BFF
  `app/api/annotatie/agent/route.ts` = SSE-passthrough naar `graphQaBaseUrl()` + `GRAPH_QA_TOKEN`
  (client-helper `annoteerAgentStream` in `lib/api.ts`), en het documentpaneel haalt de artikeltekst via
  `app/api/annotatie/artikel/route.ts` → graph-qa `GET /v1/artikel` (`haalArtikelGraaf`). De **persistente
  review-state via de api** — BFF `app/api/annotatie/documenten/*` → `/v1/annotatie/*` via `proxy()`, mét
  de vertrouwde `X-User-Id` uit de sessie (annotatie-documenten zijn **per-gebruiker gescopet**, net als
  de gesprekken). Types in `lib/types.ts` (afgeleid van `api/app/annotatie_contracts.py`).
- **Config:** `GRAPH_QA_URL` (intern, default `http://graph-qa:8080`, via `graphQaBaseUrl()`) +
  `GRAPH_QA_TOKEN(_FILE)` — de frontend moet graph-qa op het gedeelde docker-netwerk kunnen
  bereiken (`lib/config.ts`).

### Berichten en feedback

Twee kleine domeinen die aan de app-shell hangen, niet aan de oude paginanavigatie:

- **Berichten** (release notes) — `BerichtenPanel` is de bel in de **sidebar-kop** met een
  ongelezen-badge; het archief is de niet-admin tab `/instellingen/berichten`. Let op de naamval:
  `Bericht`/`BerichtInvoer` in `lib/types.ts` zijn **chatbeurten**, `BerichtOut` en familie zijn
  release notes — twee losstaande API-domeinen (`/v1/gesprekken/…/berichten` vs `/v1/berichten`).
- **Feedback** — `FeedbackDialoog` opent vanuit het gebruikersmenu onderin de sidebar. Bewust
  **geen zwevende knop** zoals elders gebruikelijk: die valt over de chat-invoer van de werkplek.
  De ongelezen-teller voor beheerders zit als badge op de feedbacktab (`TabDef.badge`).

Beide panelen halen hun teller periodiek/bij openen op en falen **stil**: een hapering mag de
werkplek niet blokkeren, de badge is een hint.

### Annoteren op onderwerp

Noemt de vraag een onderwerp in plaats van een bepaling, dan komt er een `kandidaten`-event in plaats
van `doel`/`element`: de thread toont een keuzelijst (`KandidatenKeuze`), en één klik stuurt
`kandidaatPrompt(k)` als nieuwe beurt in — mét het bwbId, anders kan de ophaal-agent bij een andere
bepaling uitkomen dan de jurist aanwees. Er is bewust géén "annoteer ze allemaal": elke annotatie is
een eigen document met een eigen review. De kandidaten zitten niet in het berichtcontract van de api;
wat na een herlaadbeurt overblijft is de opsomming uit `kandidatenAlsTekst`.

### De artefact-werkbank

Vanaf **1280px** (`lib/useBreedScherm.ts`) staat het artefact als **eigen kolom naast de chat** in
plaats van eroverheen: `Dialog` heeft daarvoor de variant **`kolom`** — geen backdrop, geen
`aria-modal` en géén focus-trap (die zou je opsluiten terwijl de chat er juist naast bereikbaar moet
zijn); Escape sluit in alle varianten. Daaronder blijft het de bestaande `side`-sheet. De splitsing
zit in `WerkplekClient` zelf en niet in `WorkbenchShell`, anders moeten `docs`/`infos` en alle
handlers omhoog en weer terug omlaag.

Binnen het artefact hebben **wettekst en reviewlijst elk hun eigen scroll** (tekst `max-h-[45%]`
bovenin). Eén gedeelde scroller liet de tekst uit beeld lopen zodra je verderop in de lijst kwam.
Selecteren scrolt **beide kanten op** in beeld: de markering in de tekst (`DocumentPaneel`) én de
kaart in de lijst (`ReviewQueue`), met `prefers-reduced-motion` gerespecteerd.

- **De kaart is compact**; details (toelichting, Critic-motivatie, alternatieven, adviesdraadje,
  opmerking) vouwen open bij selectie. Eén begrip stuurt alles: `actief`. Een **openstaande
  kanttekening** blijft ook ingeklapt zichtbaar — dat signaal mag je niet missen.
- **De lijst ordent zichzelf** (`sorteerReview`): te beoordelen vóór beslist, daarbinnen rood → geel
  → groen, daarbinnen de volgorde in de tekst. Stabiel, dus kaarten verspringen niet onder je handen.
  Filter: *alles* / *te beoordelen* / *met aandacht*.
- **Zwevende markeringen worden benoemd.** Is een fragment niet meer in de tekst te vinden
  (`vindPositie` → `-1`), dan verdween de markering eerder stilzwijgend. Nu staat het op de kaart en
  in de teller. (Zelfde les als Hypothesis' "orphans".)
- **Toetsenbord**: `j`/`k` (of ↓/↑) door de getoonde lijst, `a` akkoord, `x` verwerpen, `c` klasse,
  `Escape` loslaten. De listener doet **niets zolang de focus in een invoerveld staat** — anders keur
  je iets goed door "a" te typen in een toelichting. Na `Akkoord` springt de selectie door naar het
  volgende dat nog aandacht vraagt; knop en toets lopen via dezelfde `onAkkoord`.
- De **volgorde en de open bedieningsrij leven in `ArtefactPaneel`**, niet in de lijst: zo doorloopt
  het toetsenbord gegarandeerd dezelfde volgorde als je ziet, en staat er nooit op twee kaarten
  tegelijk een rij open.

### Eén gesprek: vragen gaan altijd via het centrale venster

De reviewkaart had een eigen mini-chat (`AdviesDraadje`). Die bestond alleen omdat het artefact
modaal was; nu het ernaast staat is hij **verwijderd**. In plaats daarvan zet *Vraag de assistent* op
de kaart een vraag klaar in het chatveld:

- `WerkplekClient` houdt `vraagOver` (slug + element). Zolang dat staat toont een **chip** boven het
  invoerveld waar de vraag over gaat, en gaat de beurt met `modus: "advies"` + `vraagContextVan(...)`.
  De chip verdwijnt na het versturen — anders wordt je vólgende vraag ongemerkt ook een adviesvraag.
- Het antwoord is een gewone beurt en krijgt daarmee **bronnen, grounding en de kopieerknop**, die het
  draadje in de kaart geen van alle had.
- De chip is UI-state en reist niet mee naar de api; het bewaarde bericht krijgt daarom een
  contextregel (`Bij <klasse> — "<fragment>" (art. 36): <vraag>`), zoals `kandidatenAlsTekst`.
- Op een **smal scherm** sluit het artefact bij het versturen: daar ligt het over de chat heen en zou
  je het antwoord niet zien binnenkomen.

**Stoppen kan.** De verzendknop wordt tijdens het streamen een stopknop (`AbortController` →
`annoteerAgentStream(..., signal)`). Een `AbortError` is géén fout: wat er al stond blijft staan met
`_(afgebroken)_` erachter en wordt zo ook bewaard.

**Niets faalt meer stil.** Het artefact openen toont een laadstand en bij een fout een `Melding` met
*Opnieuw proberen* (voorheen: een klik waar letterlijk niets van gebeurde als de graaf plat lag). Een
mislukte beslissing landt in de `Melding` ván het artefact — `WerkplekClient.beslissing` gooit hem
door en `ArtefactPaneel.beslis`/`wis` vangen hem — niet meer als chatbericht in de thread.

**De annotatie blijft bereikbaar** via een balk boven de chat (`art. 36 · 10 elementen · 3 te
beoordelen · Openen`) zodra het paneel dicht is; de chip in de thread scrolt immers weg.

**"Mogelijk ontbrekend" is werkvoorraad, geen mededeling** (`components/workbench/OntbrekendLijst.tsx`).
Staat er een letterlijk fragment bij dat in de tekst voorkomt → *Toevoegen als \<klasse\>*, één klik,
met anker. Anders zegt het kaartje waaróm het niet kan (geen fragment aangewezen, of het fragment
staat niet letterlijk in de tekst). Wegleggen kan altijd, maar is **sessie-only**: `ontbrekend` hoort
bij het chatbericht, niet bij het annotatiedocument, en er is geen veld voor "afgehandeld".

### Toegankelijkheid (WCAG 2.2 AA, NLDS-niveau)

- Markeringen in de tekst zijn **`<button>`**, geen `<mark onClick>`: anders zijn ze niet focusbaar
  en niet met het toetsenbord te bedienen (2.1.1). `<button>` is phrasing content en mag dus in de
  lopende tekst staan.
- **Klikdoelen ≥ 24×24 CSS-px** (2.5.8) via `min-h-[24px]` op chips/knoppen, met de bestaande
  `coarse:`-variant naar 44px op aanraakschermen (het AAA-niveau 2.5.5 dat NLDS aanhoudt).
- Eén **`.focus-ring`-utility** in `globals.css` (2.4.13, AAA): dubbele ring zodat de focus ook op de
  donkere JAS-klassekleuren opvalt. Gebruik die in plaats van een eigen `focus-visible:outline`.
- Elke wijziging wordt **aangekondigd** via de `sr-only aria-live`-regio in `WerkplekClient`
  (`beslissingMelding`). Zonder dat gebeurt annoteren voor een schermlezer volledig stil.

### Reviewen zonder formulier

De reviewkaart kent geen modi meer (`Aanpassen` → veld → reden → `Opslaan`). Elk veld schrijft
zichzelf weg en de `review_reason` wordt **afgeleid** uit wát er veranderde
(`redenVoorWijziging` in `lib/annotatie.ts`: tekst → `tekst`, klasse → `verkeerde_klasse`,
toelichting → `interpretatie`, meerdere velden → `anders`). Vragen wat je zojuist deed is dubbelop.

- **Klasse** = de badge zelf; klikken opent het palet, klikken op een klasse ís de wijziging.
- **Toelichting** is een inline veld (Enter/blur bewaart, Escape annuleert). Een gevulde toelichting
  leegmaken vraagt een tweede klik — dat doe je met één misklik en er is geen undo.
- **× betekent weghalen**, met twee uitkomsten achter hetzelfde gebaar: een agent-voorstel klapt de
  redenen-chips uit (één klik = verworpen, terug te draaien met `Akkoord`), een eigen markering
  verandert in "Wissen?" en is na de tweede klik echt weg (`DELETE`).
- **De reden blijft alleen bij verwerpen een vraag**: die informatie heeft alleen de mens.
- **Fragment inkorten/uitbreiden**: klik de markering aan en selecteer opnieuw. Raakt de selectie het
  bereik van de actieve markering (`overlaptSelectie` + `vindPositie`, dezelfde functie als de
  weergave), dan biedt `SelectiePopover` bovenaan *Fragment aanpassen* aan — één klik, mét een nieuw
  anker. Geen overlap = gewoon een nieuwe markering. Bewust wél die klik: een selectie die je maakte
  om te lezen mag nooit stilzwijgend een annotatie wijzigen.
- **Geen lifecycle-jargon in beeld**: de kaart toont "voorstel van de assistent" / "door jou
  aangepast" / "door jou gemarkeerd" + tijd. Het volledige spoor staat in het auditlog.

### Zelf annoteren (tekstselectie)

De jurist kan in `DocumentPaneel` tekst selecteren en die zelf markeren. Drie dingen om te kennen:

- **De rekenkern staat in `lib/selectie.ts`**, niet in het component: vitest draait node-env zonder
  DOM, dus alleen zo is die logica te testen. Het component doet enkel de `TreeWalker`-wandeling en
  geeft knooplengtes door aan `offsetUit`. Dat werkt doordat de alinea één aaneengesloten reeks
  `span`/`mark` is waarvan de tekstknopen samen exact de bron vormen.
- **Elk element draagt een `anker`**: exacte offsets + quote-met-context + een hash van de bron.
  `segmenteer` gebruikt die in drie stappen (offsets → context → eerste voorkomen), waardoor twee
  identieke fragmenten in één artikel uit elkaar blijven en een markering een herimport overleeft. `vindplaats` blijft de mensleesbare bronaanduiding; daar horen geen offsets in.
- **De tekst toont hoogstens ÉÉN markering: de geselecteerde.** Alles tegelijk kleuren was
  onleesbaar én onvolledig — twee markeringen kunnen niet op dezelfde tekst liggen, dus wat binnen
  een langere markering viel (een Rechtsobject in een zin die als geheel een Afleidingsregel is)
  verdween uit beeld. De reviewlijst is de ingang; de tekst laat zien wáár het gekozen element
  staat. Nog eens klikken verbergt hem weer, en een eigen verse markering wordt meteen actief.
  Daarmee is er ook geen overlap-prioritering meer nodig in `segmenteer`; de bevriezingsregel
  (mens wint) leeft server-side.

Eigen markeringen gaan via `POST .../elementen` (niet de PUT: dat is de uitkomst van een
agent-ronde) en zijn meteen `human_approved`. Verwijderen kan alleen bij je eigen markeringen; een
agent-voorstel verwérp je, zodat het auditspoor laat zien dát er een voorstel was.

## Observability

`instrumentation.ts` registreert OpenTelemetry via `@vercel/otel` (gated op
`OTEL_EXPORTER_OTLP_ENDPOINT`; auto-tracing van route handlers + uitgaande `fetch` met
traceparent-propagatie → end-to-end trace over de keten frontend → API/graph-qa). `lib/logger.ts` is de
**server-only** gestructureerde JSON-logger (mirror van de MCP-logger: secret-redactie, `LOG_LEVEL`,
`trace_id`/`span_id`), ingezet in de BFF-lagen (`app/api/_lib/proxy.ts`, `lib/server.ts`, de
annotatie-agent-route). Nooit
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
  **`analist`** (de rest) — afgedwongen in de `authorized`-callback (edge) én server-side in
  `app/instellingen/[[...tab]]/page.tsx` (`isAdminTab(actief) && !isBeheerder` → redirect). De eerste keer (lege users-tabel) maakt `/setup` eenmalig de eerste
  beheerder; daarna sluit die route. **Gebruikersbeheer** zit in de beheertab (`UsersPanel`, achter het
  admin-token). **2FA (TOTP)** is optioneel en self-service in de accounttab; verdere gebruikers maakt
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
- **Geen keuzemenu's — het is chat op de graaf.** De werkplek kiest geen wet uit een lijst: je stelt
  je vraag/annotatie-opdracht en de agent vindt de bepaling in de graaf (het `doel`-event levert
  `bwbId`/`artikel`/`citeertitel`). Er is dus geen wet-dropdown of wet-catalogus meer.
- **Huisstijl via tokens, niet hardcoded.** Kleur en typografie lopen via de tokens in
  `app/globals.css` + `tailwind.config.ts` (en `lib/jas.ts` voor de JAS-badges) — strooi
  geen losse hex-waarden door componenten. Het officiële logo-asset (`public/belastingdienst-logo.svg`)
  blijft ongewijzigd; de JAS-klassekleuren komen exact uit `docs/wetsanalyse/wa-table.png`.

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
