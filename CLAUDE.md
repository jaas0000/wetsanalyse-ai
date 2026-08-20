# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wat dit project is

Een **agent-platform** voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden
van Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS). De kern is een gedeployde dienst — de **wetsanalyse-API**, de
**webapp met de werkplek** en de eigen **QA/annotatie-agent (`tools/graph-qa/`, **Lex**)** op de
**BWB-kennisgraaf** — die als Portainer-stacks op een docker-host draait. De graaf wordt gevuld
door de **BWB-importer** (`tools/bwb-import/`), die de wettekst rechtstreeks bij overheid.nl ophaalt.

Brongetrouwheid is niet onderhandelbaar: werk alleen met letterlijk opgehaalde wettekst, citeer
letterlijk, en houd elke markering/annotatie herleidbaar naar artikel + lid + `bronreferentie`
(jci-uri). Het platform is een hulpmiddel voor de jurist, geen vervanger — de AI produceert, de mens
beoordeelt en corrigeert; interpretatiekeuzes (incl. twijfel en aannames) worden expliciet gemaakt in
plaats van schijnzekerheid.

> **Scope: activiteit 2.** Het platform levert het markeren + classificeren in JAS-klassen; alle
> contracten dragen `scope: "act2"`. Begrippen (activiteit 3) en de RegelSpraak-formalisering horen
> niet tot de huidige functionaliteit — die worden later op agentische basis gebouwd. graph-qa's
> begrip-definitie-QA (de `definitie`-specialist over de graaf) staat daar los van.

### Platform-componenten

1. **`api/`** — headless FastAPI-backend (PostgreSQL-opslag, per-client bearer-auth) voor de werkplek.
   Bedient het **annotatie-domein** (`/v1/annotatie/*`: documenten/elementen/beslissingen +
   append-only auditlog), de **chatgeschiedenis** (`/v1/gesprekken/*`), het
   **login-/gebruikersbeheer** (de API is de identiteitsbron van de webapp), het
   **LLM-modelprofielbeheer** (`/v1/admin/*`; de env-`LLM_*`-waarden seeden alleen het eerste
   default-profiel) en de **profiel-keuzelijst** (`/v1/profiles`). Annotatie-documenten en gesprekken
   zijn **per gebruiker gescopet**. Eigen `CLAUDE.md` + `README.md`.
2. **`frontend/`** — Next.js-webapp (BFF) bovenop de API. De app **is de werkplek** (`/workbench`, de
   *Lex-pagina*): één chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, live tegen
   graph-qa (SSE); de home leidt daarheen door. Account, beheer en instellingen openen als
   **dialoog over de werkplek heen** (`/instellingen/*`, intercepting routes) in plaats van als eigen
   pagina's; de beheertab (modelprofielen, gebruikers, API-tokens) zit achter een apart admin-token.
   De hele webapp zit achter een **login met userid + wachtwoord** (Auth.js; e-mail verplicht/uniek
   maar geen inlog-identiteit; de API is de identiteitsbron; rollen `beheerder`/`analist`; eenmalige
   eerste-beheerder-registratie via `/setup`; optionele TOTP-2FA). De UI volgt de **Rijkshuisstijl**
   (Belastingdienst-stijlvak: lintblauw, Fira-fonts, het officiële Belastingdienst-logo en
   JAS-klassekleuren uit `docs/wetsanalyse/wa-table.png`). Eigen `CLAUDE.md` + `README.md`.
3. **`tools/graph-qa/`** — de eigen **QA/annotatie-agent**, **Lex** (de naam die de gebruiker ziet; de
   code, het image en de stack heten `graph-qa`), die vragen over
   wet- en regelgeving beantwoordt door de BWB-**kennisgraaf** (GraphDB via MCP) te bevragen en het
   antwoord **brongetrouw** te onderbouwen (grounding + bronnen uit de tool-trace). Eén **unified
   LangGraph-agent**: een **supervisor** kiest per vraag een worker-keten — de **antwoord-worker**
   (specialisten `definitie`/`duiding`/`algemeen`: agent ⇄ tools → verify → finalize) of de
   **annotatie-worker** (ophaal → annoteer → **Critic** → advance, met aandacht-niveau 🟢🟡🔴).
   Endpoints: `POST /v1/runs` (+ `/events`, `/cancel`; de weg van de werkplek — de beurt draait bij de
   agent, de browser kijkt mee), `POST /v1/chat` (SSE, aan de verbinding gekoppeld en **zonder
   eigenaarscontrole** — niet voor de webapp) en `GET /v1/artikel`. De werkplek praat er **direct** mee (SSE);
   de persistente review-state loopt via de API (`/v1/annotatie/*`). Image `ghcr.io/palmw01/graph-qa`.
   Eigen `CLAUDE.md` + `README.md`.
4. **`tools/bwb-import/`** — de **BWB-importer**: haalt de wettekst op bij
   `repository.officiele-overheidspublicaties.nl`, valideert tegen de officiële XSD's, parseert de
   structuur (regeling → hoofdstuk/afdeling → artikel → lid → onderdeel, met verwijzingen) en schrijft
   RDF naar GraphDB, repository `inning`. Met `BWB_IMPORT_WTI=true` komt de WTI-verrijking mee:
   verantwoordelijke organisatie, wetsfamilie, grondslagen, rechtsgebieden, citeertitels. Per wet
   **idempotent** (named-graph `PUT`), dus herimporteren is veilig. Image
   `ghcr.io/palmw01/bwb-import`; stack `deploy/bwb-import/` met een wekelijkse herimport.
5. **De kennisgraaf zelf** (`deploy/graphdb/`) — GraphDB 11.4 met de repository `inning`, plus een
   nginx'je dat het bearer-token controleert en het GraphDB-service-account injecteert. **GraphDB
   ≥ 11.2 heeft de MCP-server ingebouwd** op `/mcp`, dus er is geen aparte MCP-container.
   GraphDB-security staat aan. Data lokaal op de docker-host (`/var/lib/graphdb/home`); dagelijkse RDF-dump die
   meelift in de host-back-up.
6. **`.claude/skills/wetsanalyse/`** — de inhoudelijke skill: de operationele uitwerking van de
   JAS-methode (de dertien klassen, het volg-beleid voor verwijzingen, de reviewcontracten) plus de
   scripts eromheen. Zie §*De wetsanalyse-skill*.

### Ondersteunende tools

- **`tools/wetsanalyse-admin-mcp/`** — stdio-MCP die de admin-API (`/v1/admin/*`) als tools ontsluit.

## De onderdelen hangen via paden samen

Dit is een verzameling losse onderdelen, geen monorepo met één buildsysteem. Het bindmiddel
zijn **projectrelatieve paden**, zodat de map portabel is tussen machines/OS'en:

- `.claude/settings.json` → **gedeeld en gecommit**: bevat een `PreToolUse`-hook die
  `.claude/skills/wetsanalyse/scripts/write_guard.py` aanroept bij elke Write/Edit-tool. De guard
  blokkeert schrijven naar `analyses/**/werk/**/feedback.json` (uitsluitend de review-server schrijft
  dat) en het overschrijven van een `analyse.json` in `werk/` zodra de ronde **voltooid** is — d.w.z.
  zodra `feedback.json` in de ronde-map bestaat (gereviewde rondes zijn immutabel; correcties vóór de
  review mogen wél). De hook is **cwd-relatief**: draai Write/Edit vanaf de projectroot of met
  absolute paden.
- `.claude/settings.local.json` → een **machine-lokale** allowlist plus de tokens (o.a.
  `WETSANALYSE_ADMIN_TOKEN`). Dit bestand is **gitignored**, dus het reist niet mee: een andere machine/analist bouwt z'n eigen lijst opnieuw op
  via de permissieprompts. De allowlist is bewust krap en portabel — de grants gebruiken wildcards
  in plaats van absolute paden.

Let op bij hernoemen/verplaatsen van de projectmap: een padmismatch leidt hooguit tot een extra
permissieprompt (geen stille breuk). Draai daarna `claude mcp list` → verwacht `✓ Connected`.

## Veelgebruikte commando's

Per onderdeel gelden eigen commando's — zie de respectievelijke `CLAUDE.md`/`README.md`
(`api/`, `frontend/`, `tools/graph-qa/`, `tools/bwb-import/`, `tools/wetsanalyse-admin-mcp/`).
Sessie-MCP-gezondheid vanuit de projectroot: `claude mcp list`.

## De wetsanalyse-skill

`.claude/skills/wetsanalyse/SKILL.md` is de gezaghebbende beschrijving. Twee dingen om te weten:

**De skill is de canonieke inhoudsbron.** `scripts/validate_analyse.py` bevat de dertien JAS-klassen
in hun canonieke weergave-volgorde, en de API laadt dat script **op runtime** in
(`api/app/validation.py` → `GELDIGE_JAS_KLASSEN`; daarom kopieert `api/Dockerfile` de skill mee).
Wijzig je de klassenlijst, dan wijzig je hem hier — niet op een tweede plek. `tools/graph-qa/` heeft
een eigen kopie met een drift-guard-test ertegen.

**De interactieve werkstroom heeft geen tekstbron.** Stap 1 haalde wettekst op via een
wettenbank-MCP die niet meer bestaat; de skill kan dus niet end-to-end draaien. De inhoudelijke
`references/` blijven wel de operationele uitwerking van de methode:

- `references/jas-klassen-referentie.md` — de dertien JAS-klassen. Verzin er geen bij.
- `references/verwijzingen-volgen.md` — het volg-beleid voor cross-referenties: functies,
  diepte-cap 1 + relevantie-gate, bounded delegaties. Een gevolgde delegatie/definitie kan
  promoveren tot een eigen bron in het werkgebied.
- `references/review-checkpoints.md` — het datacontract van `analyse.json`/`rapport.json`
  (werkgebied + bronnen) en de human-in-the-loop reviewlus: schrijf een ronde, valideer mechanisch,
  toon hem via `scripts/review_server.py` (poort 3118), verwerk `feedback.json`, herhaal tot de
  analist akkoord is (cap: 6 rondes). Nooit zelf doorgaan zonder bevestiging.
- `references/harness-diagnose.md` — de ingang bij onbetrouwbare output (verzonnen tekst,
  niet-bestaande klasse, overgeslagen review, niet-convergerende lus). Diagnosticeert via vier
  hendels (Context, Tools, Loop, Governance) in plaats van het model te verdenken.

Een analyse landt in `analyses/<werkgebied>/`: per **werkgebied** (een kennisdomein met **meerdere
bronnen** — een bron = `bwbId`+`artikel`+`lid?`, niet één artikel) het eindrapport plus de
`werk/`-tussenbestanden. Het rapport wordt **gegenereerd, niet overgetypt**:
`scripts/build_rapport_json.py` combineert de gevalideerde rondes tot één `rapport.json`, en
`scripts/rapport_server.py` (poort 3119) toont die met een knop om Markdown weg te schrijven.

## Observability

Alle draaiende onderdelen (API, frontend, graph-qa) zijn **geïnstrumenteerd, niet bemeterd**:
ze emitteren gestructureerde JSON-logs (één gedeelde vorm, bv. `frontend/lib/logger.ts`)
en kunnen OpenTelemetry (traces/metrics/logs) naar een **configureerbaar OTLP-endpoint** sturen
(`OTEL_EXPORTER_OTLP_ENDPOINT`; leeg = alleen logs, nul overhead). Eén trace-id verbindt de keten
frontend → API → graph-qa. De **verzamelstack staat in `deploy/observability/`** en draait op de
docker-host (stack `observability`): OTel-Collector (met
**spanmetrics/servicegraph-connectors** die topologie-edges uit de traces afleiden) + Tempo + Loki +
Prometheus, plus **Alloy** dat stdout-logs naar Loki shipt en **Grafana zelf** (grafana.example; de
datasources komen als file-provisioning uit de stack en zijn in de UI dus read-only). Twee
kant-en-klare dashboards (`grafana-dashboard-wetsanalyse.json` = trends;
`grafana-dashboard-topologie.json` = *"systeemtopologie"*: de live keten die oplicht op basis van de
trace-servicegraph) en **alerting** (`alerting/`; 3 regels die het default notification-beleid van je
Grafana volgen — géén eigen contactpunt). Deployen via
`.github/workflows/deploy-observability.yml`, dashboards via `provision-grafana.sh`. De volledige
uitleg (env-vars, logschema, AVG-redactie, dashboard/alerting) staat in **`docs/observability.md`**.

## Uitrollen

**Dev** — één vaste, gedeelde omgeving op **https://dev.wetsanalyse.example** met een eigen database,
naast de graaf en de observability-stack op dezelfde docker-host. Handmatig: Actions → *dev-deploy* →
*Run workflow* → kies de branch; `destroy: true` breekt stack, database en proxyhost weer af.
Workflow `.github/workflows/dev-deploy.yml` + stack `deploy/dev/docker-compose.yml`; setup en de
volgorde-afhankelijkheden (graaf en observability eerst, want hun netwerken zijn extern) staan in
**`deploy/dev/README.md`**.

**De graaf** — `.github/workflows/deploy-graaf.yml` rolt de graphdb-stack en de importer in de juiste
volgorde uit (GraphDB eerst: die maakt het netwerk `graphdb_default` waar de rest op joint).

**Productie** — vijf losse Portainer-stacks met een **volgorde-afhankelijkheid via de netwerken**:

| # | stack | maakt | joint op | hostpoort |
|---|---|---|---|---|
| 1 | `deploy/postgres/` | `wetsanalyse_internal` | — | nee |
| 2 | `deploy/graphdb/` | `graphdb_default` | — | 7200 + 8004 |
| 3 | `deploy/observability/` | `observability_default` | — | 3001 (Grafana) |
| 4 | `api/`, `tools/graph-qa/` | — | de netwerken hierboven | api 8081; graph-qa geen |
| 5 | `frontend/` | — | `wetsanalyse_internal` + observability | 8080 |

De eerste drie maken de netwerken; deployt een latere stack eerder, dan faalt hij op een ontbrekend
extern netwerk. **nginx-proxy-manager draait op een andere host** en deelt dus geen docker-netwerk:
wie publiek moet zijn publiceert een hostpoort en NPM forwardt naar `<docker-host-ip>:<poort>`.
graph-qa is bewust intern-only.

**Images** — `{api,frontend,graph-qa,bwb-import}-docker-publish.yml` bouwen bij een push naar master
naar GHCR, met pip-audit/npm-audit vooraf en een Trivy-gate achteraf. Bij master doen ze
aansluitend een `az containerapp update` (of `az containerapp job update` bij bwb-import) op de
Azure-omgeving — image-swap, geen infra-wijziging. Op de Portainer-productie is uitrollen wél een
aparte, expliciete stap.

**Azure** — `deploy/azure/` is de tweede uitrolplek van de stack, mét eigen GraphDB en importer.
`azure-infra.yml` is handmatig (bicep-wijzigingen raken GraphDB en die is niet-persistent) en kent
`wat-if` (valideert, maakt niets aan), `deploy` en `afbreken`. Image-refreshes komen automatisch
uit de publish-workflows. Zie `deploy/azure/README.md` — let vooral op de GraphDB-licentie, zonder
welke de graaf read-only opkomt.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code):

- `docs/wetsanalyse/` — het bronmateriaal van de methode: `handleiding.pages.md`,
  `leidraad.pages.md`, `wetsanalyse-boek.md`, `WetsTaal.md`, de JAS-tabel `wa-table.png` en
  `wetsanalyse-rijk/` (hoofdstukken over JAS en het kader). Raadpleeg deze bij inhoudelijke vragen
  over de methode; de skill-`references/` zijn de operationele samenvatting daarvan.
- `docs/regelspraak/` — de RegelSpraak-specificaties (PDF), voor de latere formaliseringsfase.
- `docs/wetsanalyse-workbench/` — het plan achter de werkplek + de JAS-annotatie-ontologie.
- `docs/kennisbank/PLAN.md` — het gefaseerde plan voor een **tweede corpus** naast de wetsgraaf
  (beleidsstukken en handleidingen die Lex samen met de wettekst mag bevragen). Nog niet gebouwd;
  lees het vóór je aan retrieval of grounding werkt, want het stelt eisen aan beide.
- `docs/observability.md` en `docs/schrijfrichtlijn-lex.md` (de toon van Lex; zijn identiteit staat in
  `tools/graph-qa/agent/prompts.py`).
