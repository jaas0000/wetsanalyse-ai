# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wat dit project is

Een **agent-platform** voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden
van Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS). De kern is een gedeployde dienst — de **wetsanalyse-API**, de
**webapp met de werkplek**, de eigen **QA/annotatie-agent (`tools/graph-qa/`, "de Juridische
Assistent")** en de **wettenbank-MCP** als databron — die draait op Azure Container Apps én Portainer.

Brongetrouwheid is niet onderhandelbaar: werk alleen met letterlijk opgehaalde wettekst, citeer
letterlijk, en houd elke markering/begrip/regel/annotatie herleidbaar naar artikel + lid +
`bronreferentie` (jci-uri). Het platform is een hulpmiddel voor de jurist, geen vervanger — de AI
produceert, de mens beoordeelt en corrigeert; interpretatiekeuzes (incl. twijfel en aannames) worden
expliciet gemaakt in plaats van schijnzekerheid.

> **Legacy / oorsprong.** Het project begon als een **interactieve Claude Code-skill** in de CLI
> (`.claude/skills/wetsanalyse` + `regelspraak`). Dat skill-spoor bestaat nog en is de **gedeelde
> inhoudsbron** (`references/`/`scripts/`) die het platform op runtime hergebruikt — maar het is niet
> langer de kern. De skill-werkstromen staan verderop (§*De wetsanalyse-skill* / *De regelspraak-skill*).

### Platform-componenten

1. **`tools/wettenbank-mcp/`** — een MCP-server (TypeScript) die de actuele wettekst ophaalt via de
   publieke SRU-API van `overheid.nl`. Dit is de databron. Heeft een eigen, gedetailleerde
   `CLAUDE.md` — lees die bij werk *in* de MCP.
2. **`api/`** — headless FastAPI-backend (PostgreSQL-jobstore, per-client bearer-auth) die de
   JAS-werkstroom als async REST-API aanbiedt: analyses aanmaken/reviewen (een **werkgebied** met
   meerdere bronnen), al ná activiteit 2 afronden (`scope: "act2"`) met act3 on-demand
   (`POST /v1/projects/{id}/act3`), en de **RegelSpraak-formaliseringsfase** als on-demand vervolg
   (`POST /v1/projects/{id}/regelspraak`). Bevat óók het **annotatie-domein** van de werkplek
   (`/v1/annotatie/*`: documenten/elementen/beslissingen + append-only auditlog). Het LLM wordt
   aangestuurd via **benoemde modelprofielen** (in de database, beheerbaar via `/v1/admin/profiles`;
   de env-`LLM_*`-waarden seeden alleen het eerste default-profiel). Eigen `CLAUDE.md` + `README.md`.
3. **`frontend/`** — Next.js-webapp (BFF) bovenop de API, met twee gezichten. (a) De **analyse-webapp**:
   analyses aanmaken (wet-dropdown met **artikel-autocomplete + lid-keuze**, en optioneel een
   **bestaande begrippenlijst** plakken/uploaden als suggestieve act-3-invoer), de human-in-the-loop
   review-lus, het rapport, de **RegelSpraak-fase** ("Naar RegelSpraak") en het **`/beheer`-scherm**
   (modelprofielen, wet-catalogus, gebruikers, token-verbruik; achter een apart admin-token). (b) **De
   werkplek** (`/workbench`, de *Assistent-pagina*): één gespreksvenster voor **vragen én
   JAS-annotatie**, live tegen graph-qa. De hele webapp zit achter een **login met userid +
   wachtwoord** (Auth.js; e-mail verplicht/uniek maar geen inlog-identiteit; de API is de
   identiteitsbron; rollen `beheerder`/`analist`; eenmalige eerste-beheerder-registratie via `/setup`;
   optionele TOTP-2FA via `/account`). De UI volgt de **Rijkshuisstijl** (Belastingdienst-stijlvak:
   lintblauw, Fira-fonts, het officiële Belastingdienst-logo en JAS-klassekleuren uit
   `docs/wetsanalyse/wa-table.png`). Eigen `CLAUDE.md` + `README.md`.
4. **`tools/graph-qa/`** — de eigen **QA/annotatie-agent** ("de Juridische Assistent") die vragen over
   wet- en regelgeving beantwoordt door de BWB-**kennisgraaf** (GraphDB via MCP) te bevragen en het
   antwoord **brongetrouw** te onderbouwen (grounding + bronnen uit de tool-trace). Eén **unified
   LangGraph-agent**: een **supervisor** kiest per vraag een worker-keten — de **antwoord-worker**
   (specialisten `definitie`/`duiding`/`algemeen`: agent ⇄ tools → verify → finalize) of de
   **annotatie-worker** (ophaal → annoteer → **Critic** → advance, met aandacht-niveau 🟢🟡🔴).
   Endpoints: `POST /v1/chat` (SSE) en `GET /v1/artikel`. De werkplek praat er **direct** mee (SSE);
   de persistente review-state loopt via de API (`/v1/annotatie/*`). Deployt via CI naar Azure
   Container Apps én een Portainer-stack (image `ghcr.io/palmw01/graph-qa`). Eigen `CLAUDE.md` + `README.md`.
5. **`analyses/`** — output van het skill-spoor: per **werkgebied** (kennisdomein met **meerdere
   bronnen** — een bron = `bwbId`+`artikel`+`lid?`, niet één artikel) een map met het eindrapport en de
   `werk/`-tussenbestanden, plus desgewenst een `regelspraak/`-submap met het RegelSpraak-`model.json`.
   Activiteit 2 markeert per bron; activiteit 3 levert één gedeelde, ontdubbelde begrippenlijst over
   alle bronnen. De map heet naar de werkgebied-naam (kebab-case); bij ontbreken valt ze terug op de
   eerste bron (`<bwbid>-art<nr>[-lidN]`).

### Legacy / oorsprong — het skill-spoor (gedeelde inhoudsbron)

6. **`.claude/skills/wetsanalyse/`** — de inhoudelijke skill die de analyse **interactief in Claude
   Code** uitvoert (activiteit 2: markeren + classificeren in JAS-klassen; activiteit 3 **twee-staps**:
   3a begrippen → 3b regels met de begrippen als bouwstenen via begrip-id's) en een `rapport.json`
   oplevert (HTML-viewer; Markdown als export). De skill *gebruikt* de MCP als bron. Een afleidingsregel
   wordt **geannoteerd** met begrip-id's (uitvoer/invoer/parameters/voorwaarden per `begrip_id`, plus
   vindplaats en `markering_ids`), niet uitgeschreven in een (pseudo)regeltaal — die uitvoerbare
   formulering is de taak van de regelspraak-skill, zodat er één bron van waarheid voor de regel is.
7. **`.claude/skills/regelspraak/`** — de **vervolgskill** die de geduide afleidingsregels en begrippen
   formaliseert naar een uitvoerbare specificatie in **RegelSpraak + GegevensSpraak** (Belastingdienst/
   ALEF). Leest een afgerond `rapport.json` (via `scripts/ingest_rapport.py`) of werkt standalone vanaf
   wettekst, bouwt het objectmodel en de regels in twee stappen met elk een review-checkpoint, en levert
   een `model.json` (HTML-viewer; `.rs`/Markdown als export).

Beide skills leveren de `references/`/`scripts/` die **óók het platform** (de API-engine) op runtime
gebruikt: één inhoudelijke bron van waarheid voor de JAS-methode en RegelSpraak. graph-qa staat hier
los van — dat werkt op de GraphDB-kennisgraaf met zijn eigen toollaag en prompts.

## De onderdelen hangen via paden samen

Dit is een verzameling losse onderdelen, geen monorepo met één buildsysteem. Het bindmiddel
zijn **projectrelatieve paden**, zodat de map portabel is tussen machines/OS'en:

- `.mcp.json` → **remote HTTP**: `type: "http"`, `url: https://wettenbank-mcp.ipalm.nl/mcp`,
  met `Authorization: Bearer ${WETTENBANK_TOKEN}` (token via env, niet in de repo). De server
  draait als Portainer-stack achter Nginx Proxy Manager — zie `tools/wettenbank-mcp/CLAUDE.md`
  (Deployment). Het lokale **stdio**-alternatief (`command: "node"`,
  `args: ["tools/wettenbank-mcp/dist/index.js"]`) staat daar ook beschreven als fallback.
  Wil iemand buiten dit project alleen het publieke image `ghcr.io/palmw01/wettenbank-mcp`
  draaien, dan is `tools/wettenbank-mcp/HANDLEIDING-IMAGE.md` de beknopte instap.
  `.mcp.json` bevat daarnaast twee **sessie-tools**: `wetsanalyse-admin` (stdio-server die de
  admin-API `/v1/admin/*` als tools ontsluit; token via `WETSANALYSE_ADMIN_TOKEN` — zie
  `tools/wetsanalyse-admin-mcp/README.md`) en `grafana` (de officiële `mcp/grafana`-server voor het
  inrichten van datasources/dashboards; `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN=${GRAFANA_TOKEN}`).
- `.claude/settings.json` → **gedeeld en gecommit**: bevat een `PreToolUse`-hook die
  `scripts/write_guard.py` aanroept bij elke Write/Edit-tool. De guard beschermt beide sporen:
  hij blokkeert schrijven naar `analyses/**/werk/**/feedback.json` (uitsluitend de review-server
  schrijft dat) en het overschrijven van een `analyse.json`/`model.json` in `werk/` zodra de
  ronde **voltooid** is — d.w.z. zodra `feedback.json` in de ronde-map bestaat (gereviewde
  rondes — wetsanalyse én regelspraak — zijn immutabel; correcties vóór de review mogen wél).
- `.claude/settings.local.json` → `enabledMcpjsonServers` (bv. `["wettenbank", "grafana"]`) plus een
  **machine-lokale** allowlist en de tokens (`WETTENBANK_TOKEN`, `WETSANALYSE_ADMIN_TOKEN`,
  `GRAFANA_TOKEN`). Dit bestand is **gitignored** (`.gitignore`), dus het reist niet mee en is per definitie
  niet gedeeld: een andere machine/analist bouwt z'n eigen lijst gewoon opnieuw op via de
  permissieprompts. De allowlist is bewust krap en portabel gehouden — de grants voor
  `review_server.py` en `rapport_server.py` gebruiken wildcards i.p.v. absolute paden — zodat
  er in de praktijk geen absolute paden meer in staan om te patchen.

Let op bij hernoemen/verplaatsen van de projectmap: een padmismatch leidt hooguit tot een extra
permissieprompt (geen stille breuk). Draai daarna `claude mcp list` → verwacht `✓ Connected`.
Bij twijfel naar achtergebleven absolute paden:
`grep -rn -e "admin-willard" -e ":/Users" --include="*.json" --include="*.py" . | grep -v node_modules`.

## Veelgebruikte commando's

```bash
# MCP-server (werk altijd binnen tools/wettenbank-mcp/)
cd tools/wettenbank-mcp
npm install        # dependencies
npm run build      # TypeScript → dist/  (dist/ is nodig om te draaien en is gecommit)
npm test           # vitest unit-tests (draaien vóór een commit)
npm run test:watch
npx vitest run src/index.test.ts          # één testbestand
npx vitest run -t "naam van de test"      # één test op naam

# MCP-gezondheid (vanuit de projectroot)
claude mcp list                            # verwacht: wettenbank → ✓ Connected
```

Na het bouwen of wijzigen van de MCP-server: `claude mcp list` om te bevestigen dat hij nog
verbindt voordat je de skill gebruikt.

## De wetsanalyse-skill: werkstroom en checkpoints

De skill (`.claude/skills/wetsanalyse/SKILL.md`) is de gezaghebbende beschrijving. De
kernstructuur die meerdere bestanden raakt:

- **Stap 1** haalt tekst op via de MCP-tools `wettenbank_zoek` → `wettenbank_structuur` →
  `wettenbank_artikel` (en `wettenbank_zoekterm` voor brondefinities in definitieartikelen).
- **Stap 1b — verwijzingen inventariseren & volgen** (`references/verwijzingen-volgen.md`): de
  uitgaande verwijzingen van de bepaling opsporen (de MCP geeft getagde intref/extref per lid;
  natuurlijke-taalverwijzingen herkent de skill zelf), classificeren naar functie en volgens
  beleid volgen (diepte-cap 1 + relevantie-gate; delegaties bounded). Ze worden vastgelegd als
  `verwijzingen`-array in `analyse.json` (aparte as náást de markeringen) en horen bij het
  activiteit-2 checkpoint; begrippen koppelen via `bron_verwijzing` aan een definitie-verwijzing.
- **Activiteit 2 → checkpoint → Activiteit 3 (3a begrippen → 3b regels) → checkpoint →
  rapport.** De analist kan bij het act-2-checkpoint ook kiezen voor *afronden zonder
  activiteit 3* (in het dienst-spoor: feedback-status `akkoord-afronden` → `scope: "act2"`;
  activiteit 3 kan later alsnog). Na elke activiteit
  is er een **iteratief human-in-the-loop review**: de skill schrijft
  `werk/activiteit-{2,3}/ronde-{N}/analyse.json`, draait eerst `scripts/validate_analyse.py`
  als mechanische pre-check (ongeldige JAS-klassen, ontbrekende id's e.d.; bij activiteit 3
  met `--act2` voor de dekkingscheck markering → begrip en desgewenst `--begrippenlijst`
  voor de herkomst-checks; exit 2 blokkeert
  tot correctie), start daarna `scripts/review_server.py` (lokale webpagina op poort 3118,
  alleen stdlib; vanaf ronde 2 met `--ronde N --vorige <ronde-N-1>`), pauzeert, en verwerkt
  daarna `werk/activiteit-{2,3}/ronde-{N}/feedback.json`. Is er feedback, dan schrijft de
  skill een volgende ronde en herhaalt — tot de analist akkoord is zonder opmerkingen
  (veiligheidscap: max. 6 rondes). De skill gaat **niet** zelf door zonder bevestiging van
  de analist. De datacontracten en de lus staan in `references/review-checkpoints.md`.
- De review-stops worden alleen overgeslagen als `WETSANALYSE_NO_REVIEW=1` in de omgeving staat
  (uitsluitend voor geautomatiseerde evals).
- **Het rapport wordt gegenereerd, niet overgetypt.** `scripts/build_rapport_json.py`
  combineert de gevalideerde `analyse.json`'s van de hoogste reviewronde tot één
  `rapport.json` — de primaire bron. De skill vult de vrije tekstvelden (reviewlog-
  samenvattingen, aandachtspunten voor multidisciplinaire validatie) via de flags van
  hetzelfde script in. Daarna start de skill `scripts/rapport_server.py` (lokale HTML-viewer
  op poort 3119), waarna de analist de §4-velden desgewenst bijstelt en via de knop
  "Markdown schrijven" een `.md`-exportbestand naast de `rapport.json` laat wegschrijven.
  `scripts/render_rapport.py` blijft beschikbaar als standalone MD-generator maar maakt geen
  deel meer uit van de normale skill-flow.

Inhoudelijke regels die je moet kennen voordat je classificeert of begrippen opstelt:
`references/jas-klassen-referentie.md` (de dertien JAS-klassen — verzin er geen),
`references/begrippen-en-afleidingsregels-opstellen.md` (act 3 is twee-staps: eerst begrippen,
dán regels met de begrippen als bouwstenen via begrip-id's; werkgebied-breed hergebruik en
ontdubbeling — homoniemen splitsen, synoniemen samenvoegen; begrippen dragen
`is_interpretatie`/`relaties`/`markering_ids` en — bij een aangeleverde bestaande
begrippenlijst (`werk/begrippenlijst.json`, suggestief) — een `herkomst`
(hergebruikt/aangepast/nieuw); een afleidingsregel wordt **geannoteerd**,
niet uitgeschreven — geen pseudo-`formulering`) en `references/verwijzingen-volgen.md`
(het volg-beleid voor cross-referenties: functies, diepte/relevantie-grens, bounded delegaties;
een gevolgde delegatie/definitie kan promoveren tot een eigen bron in het werkgebied). Het
datacontract van `analyse.json`/`rapport.json` (werkgebied + bronnen) staat in
`references/review-checkpoints.md`.

## De regelspraak-skill: van geduide regel naar uitvoerbare specificatie

De skill (`.claude/skills/regelspraak/SKILL.md`) formaliseert een afgeronde wetsanalyse naar
**GegevensSpraak** (objectmodel: objecttypen, attributen, kenmerken, domeinen, parameters,
feittypen/rollen) en **RegelSpraak-regels** (RegelSpraak-spec v2.3.0). De kernstructuur:

- **Stap 1 — basis.** Bij voorkeur vanuit een wetsanalyse-`rapport.json`: draai
  `scripts/ingest_rapport.py` (deterministisch; behoudt de herkomst-id's `b*`/`r*`/`v*`) naar
  `regelspraak/werk/ingest.json` i.p.v. het rapport handmatig over te nemen. Zonder rapport werkt de
  skill standalone vanaf wettekst via de MCP.
- **Stap 2 (GegevensSpraak) → checkpoint → Stap 3 (regels) → checkpoint → model.** Dezelfde iteratieve
  human-in-the-loop lus als wetsanalyse: `validate_regelspraak.py` als pre-check, `review_server.py`
  op poort **3120** (vanaf ronde 2 met `--ronde N --vorige …`), feedback verwerken in een nieuwe ronde
  (cap 6). `build_regelspraak.py` combineert de hoogste rondes tot één `model.json` (+ `.rs`/`.md`-export)
  en `rapport_server.py` toont het op poort **3121**. Sla de reviews alleen over met
  `REGELSPRAAK_NO_REVIEW=1` (evals).
- Elke declaratie en regel draagt een **`herkomst`** naar het bron-begrip/de bron-afleidingsregel
  (en daarmee naar artikel + lid). Gebruik uitsluitend echte RegelSpraak/GegevensSpraak-taalpatronen
  uit `references/` (`gegevensspraak-referentie.md`, `regels-en-resultaat-referentie.md`,
  `expressies-en-operatoren-referentie.md`, `vertaalpatronen.md` [JAS→RegelSpraak-brug],
  `review-checkpoints.md`). Verzin geen syntax; wat er niet in staat, wordt een validatiepunt.

Het dienst-spoor biedt dezelfde fase als on-demand API-stap (`POST /v1/projects/{id}/regelspraak`),
zie `api/CLAUDE.md`.

Komt een analyse onbetrouwbaar uit (verzonnen tekst, niet-bestaande klasse, overgeslagen
review, niet-convergerende lus — géén gewone review-feedback), dan is
`references/harness-diagnose.md` de troubleshooting-ingang: het diagnosticeert de skill via
vier hendels (Context, Tools, Loop, Governance) in plaats van het model te verdenken.

## Observability

Alle draaiende onderdelen (API, frontend, MCP, graph-qa) zijn **geïnstrumenteerd, niet bemeterd**:
ze emitteren gestructureerde JSON-logs (één gedeelde vorm, bron `tools/wettenbank-mcp/src/logger.ts`)
en kunnen OpenTelemetry (traces/metrics/logs) naar een **configureerbaar OTLP-endpoint** sturen
(`OTEL_EXPORTER_OTLP_ENDPOINT`; leeg = alleen logs, nul overhead). Eén trace-id verbindt de keten
frontend → API → MCP/graph-qa. Een **optionele verzamelstack staat in `deploy/observability/`**:
OTel-Collector (met **spanmetrics/servicegraph-connectors** die topologie-edges uit de traces
afleiden) + Tempo + Loki + Prometheus, plus **Alloy** dat de stdout-logs van frontend en MCP
naar Loki shipt, **twee kant-en-klare Grafana-dashboards** (`grafana-dashboard-wetsanalyse.json` =
trends; `grafana-dashboard-topologie.json` = *"systeemtopologie"*: de live keten die oplicht +
de per-analyse jobs-tabel die het opgeheven frontend-`/dashboard` vervangt, via de read-only
jobstore-datasource `wa-postgres`) en **alerting** (`alerting/`, Grafana-contactpunt). Je koppelt 'm aan je bestaande Grafana; laat het endpoint
leeg om alles ongewijzigd met alléén JSON-logs te draaien. De volledige uitleg (env-vars, logschema,
AVG-redactie, dashboard/alerting) staat in **`docs/observability.md`**.

## Skills

De wetsanalyse-skill staat in `.claude/skills/wetsanalyse/`; de vervolgskill regelspraak (formaliseren
naar RegelSpraak/GegevensSpraak) in `.claude/skills/regelspraak/`.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code): `docs/wetsanalyse/handleiding.pages.md`,
`docs/wetsanalyse/leidraad.pages.md`, `docs/wetsanalyse/wetsanalyse-boek.md` en
`docs/wetsanalyse/wetsanalyse-rijk/` (hoofdstukken over JAS en het kader), plus de
RegelSpraak-specificaties in `docs/regelspraak/`. Raadpleeg deze bij inhoudelijke vragen over de
methode; de skill-`references/` zijn de operationele samenvatting daarvan.
