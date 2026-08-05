# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wat dit project is

Een **agent-platform** voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden
van Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS). De kern is een gedeployde dienst — de **wetsanalyse-API**, de
**webapp met de werkplek** en de eigen **QA/annotatie-agent (`tools/graph-qa/`, "de Juridische
Assistent")** op de **BWB-kennisgraaf** — die draait op Azure Container Apps én Portainer. De
**wettenbank-MCP** (live wettekst) is de databron voor het skill-spoor en de graaf-ingestie, niet
meer voor de werkplek-runtime.

Brongetrouwheid is niet onderhandelbaar: werk alleen met letterlijk opgehaalde wettekst, citeer
letterlijk, en houd elke markering/begrip/regel/annotatie herleidbaar naar artikel + lid +
`bronreferentie` (jci-uri). Het platform is een hulpmiddel voor de jurist, geen vervanger — de AI
produceert, de mens beoordeelt en corrigeert; interpretatiekeuzes (incl. twijfel en aannames) worden
expliciet gemaakt in plaats van schijnzekerheid.

> **Legacy / oorsprong.** Het project begon als een **interactieve Claude Code-skill** in de CLI
> (`.claude/skills/wetsanalyse`). Dat skill-spoor bestaat nog en is de **gedeelde
> inhoudsbron** (`references/`/`scripts/`) die het platform op runtime hergebruikt — maar het is niet
> langer de kern. De skill-werkstroom staat verderop (§*De wetsanalyse-skill*).

> **Scope nu: alleen activiteit 2.** Begrippen (activiteit 3) en de RegelSpraak-formaliseringsfase
> zijn **verwijderd** uit de engine, de webapp en het skill-spoor — die worden later opnieuw
> opgebouwd op een agentische basis. Het platform levert nu activiteit 2 (markeren + classificeren
> in JAS-klassen); alle contracten/rapporten dragen `scope: "act2"`. graph-qa's begrip-definitie-QA
> (`definitie`-specialist over de graaf) staat hier los van en blijft.

### Platform-componenten

1. **`tools/wettenbank-mcp/`** — een MCP-server (TypeScript) die de actuele wettekst ophaalt via de
   publieke SRU-API van `overheid.nl`. Databron voor het (legacy) skill-spoor en de graaf-ingestie;
   de deployte werkplek werkt op de graaf (via graph-qa) en raakt deze MCP niet. Heeft een eigen,
   gedetailleerde `CLAUDE.md` — lees die bij werk *in* de MCP.
2. **`api/`** — headless FastAPI-backend (PostgreSQL-opslag, per-client bearer-auth) voor de werkplek.
   Bedient het **annotatie-domein** (`/v1/annotatie/*`: documenten/elementen/beslissingen + append-only
   auditlog), het **login-/gebruikersbeheer** (de API is de identiteitsbron van de webapp), het
   **LLM-modelprofielbeheer** (`/v1/admin/*`; de env-`LLM_*`-waarden seeden alleen het eerste
   default-profiel) en de **profiel-keuzelijst** (`/v1/profiles`). De oude
   `/v1/projects`-analyse-pijplijn (generatie-engine, GraphDB-bron, review-lus, rapport, JAS-promotie)
   is **verwijderd** nadat de webapp erop uit ging. Eigen `CLAUDE.md` + `README.md`.
3. **`frontend/`** — Next.js-webapp (BFF) bovenop de API. De app **is de werkplek** (`/workbench`, de
   *Assistent-pagina*): één chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, live tegen
   graph-qa (SSE); de home leidt daarheen door. Daarnaast een uitgekleed **`/beheer`-scherm**
   (modelprofielen, gebruikers, API-tokens; achter een apart admin-token). De analyse-webapp (analyses
   aanmaken/reviewen/rapporteren) is **uit de frontend verwijderd**. De hele webapp zit achter een
   **login met userid + wachtwoord** (Auth.js; e-mail verplicht/uniek maar geen inlog-identiteit; de
   API is de identiteitsbron; rollen `beheerder`/`analist`; eenmalige eerste-beheerder-registratie via
   `/setup`; optionele TOTP-2FA via `/account`). De UI volgt de **Rijkshuisstijl** (Belastingdienst-
   stijlvak: lintblauw, Fira-fonts, het officiële Belastingdienst-logo en JAS-klassekleuren uit
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
   `werk/`-tussenbestanden. Activiteit 2 markeert per bron. De map heet naar de werkgebied-naam
   (kebab-case); bij ontbreken valt ze terug op de eerste bron (`<bwbid>-art<nr>[-lidN]`).

### Legacy / oorsprong — het skill-spoor (gedeelde inhoudsbron)

6. **`.claude/skills/wetsanalyse/`** — de inhoudelijke skill die de analyse **interactief in Claude
   Code** uitvoert (activiteit 2: markeren + classificeren in JAS-klassen) en een `rapport.json`
   oplevert (HTML-viewer; Markdown als export). De skill *gebruikt* de MCP als bron.

De skill levert de `references/`/`scripts/` die **óók het platform** (de API-engine) op runtime
gebruikt: één inhoudelijke bron van waarheid voor de JAS-methode. graph-qa staat hier
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
  schrijft dat) en het overschrijven van een `analyse.json` in `werk/` zodra de
  ronde **voltooid** is — d.w.z. zodra `feedback.json` in de ronde-map bestaat (gereviewde
  rondes zijn immutabel; correcties vóór de review mogen wél).
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
  activiteit-2 checkpoint.
- **Activiteit 2 → checkpoint → rapport.** Na activiteit 2
  is er een **iteratief human-in-the-loop review**: de skill schrijft
  `werk/activiteit-2/ronde-{N}/analyse.json`, draait eerst `scripts/validate_analyse.py`
  als mechanische pre-check (ongeldige JAS-klassen, ontbrekende id's e.d.; exit 2 blokkeert
  tot correctie), start daarna `scripts/review_server.py` (lokale webpagina op poort 3118,
  alleen stdlib; vanaf ronde 2 met `--ronde N --vorige <ronde-N-1>`), pauzeert, en verwerkt
  daarna `werk/activiteit-2/ronde-{N}/feedback.json`. Is er feedback, dan schrijft de
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

Inhoudelijke regels die je moet kennen voordat je classificeert:
`references/jas-klassen-referentie.md` (de dertien JAS-klassen — verzin er geen) en
`references/verwijzingen-volgen.md`
(het volg-beleid voor cross-referenties: functies, diepte/relevantie-grens, bounded delegaties;
een gevolgde delegatie/definitie kan promoveren tot een eigen bron in het werkgebied). Het
datacontract van `analyse.json`/`rapport.json` (werkgebied + bronnen) staat in
`references/review-checkpoints.md`.

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
trends; `grafana-dashboard-topologie.json` = *"systeemtopologie"*: de live keten die oplicht op basis
van de trace-servicegraph) en **alerting** (`alerting/`, Grafana-contactpunt). Je koppelt 'm aan je bestaande Grafana; laat het endpoint
leeg om alles ongewijzigd met alléén JSON-logs te draaien. De volledige uitleg (env-vars, logschema,
AVG-redactie, dashboard/alerting) staat in **`docs/observability.md`**.

## Skills

De wetsanalyse-skill staat in `.claude/skills/wetsanalyse/`.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code): `docs/wetsanalyse/handleiding.pages.md`,
`docs/wetsanalyse/leidraad.pages.md`, `docs/wetsanalyse/wetsanalyse-boek.md` en
`docs/wetsanalyse/wetsanalyse-rijk/` (hoofdstukken over JAS en het kader). Raadpleeg deze bij
inhoudelijke vragen over de methode; de skill-`references/` zijn de operationele samenvatting daarvan.
