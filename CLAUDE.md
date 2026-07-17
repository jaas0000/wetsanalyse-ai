# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wat dit project is

Werkruimte voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden van
Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en
het Juridisch Analyseschema (JAS). Het project kent een **skill-spoor** (interactief in Claude Code)
en een **dienst-spoor** (API + webapp); beide hergebruiken dezelfde MCP-databron en dezelfde
inhoudelijke `references/`/`scripts/`. De samenwerkende delen:

1. **`tools/wettenbank-mcp/`** — een MCP-server (TypeScript) die de actuele wettekst ophaalt
   via de publieke SRU-API van `overheid.nl`. Dit is de databron. Heeft een eigen, gedetailleerde
   `CLAUDE.md` — lees die bij werk *in* de MCP.
2. **`.claude/skills/wetsanalyse/`** — de inhoudelijke skill die de analyse uitvoert (activiteit 2:
   markeren + classificeren in JAS-klassen; activiteit 3: begrippen + afleidingsregels) en een
   `rapport.json` oplevert die via een HTML-viewer wordt gepresenteerd. Markdown is beschikbaar
   als afgeleid exportformaat. De skill *gebruikt* de MCP als bron. Activiteit 3 is **twee-staps**
   (3a begrippen → 3b regels): de begrippen zijn de bouwstenen, en een afleidingsregel wordt
   **geannoteerd** met begrip-id's (uitvoer/invoer/parameters/voorwaarden verwijzen per
   `begrip_id`, plus vindplaats en `markering_ids`) maar niet uitgeschreven in een
   (pseudo)regeltaal — die uitvoerbare formulering is de taak van
   de regelspraak-skill, zodat er één bron van waarheid voor de regel is.
3. **`.claude/skills/regelspraak/`** — de **vervolgskill** die de geduide afleidingsregels en
   begrippen formaliseert naar een uitvoerbare specificatie in **RegelSpraak + GegevensSpraak**
   (Belastingdienst/ALEF). Leest een afgerond `rapport.json` (via `scripts/ingest_rapport.py`, of
   werkt standalone vanaf wettekst), bouwt het objectmodel en de regels in twee stappen met elk een
   review-checkpoint, en levert een `model.json` (HTML-viewer; `.rs`/Markdown als export).
4. **`analyses/`** — output: per **werkgebied** een map met het eindrapport en de
   `werk/`-tussenbestanden, plus desgewenst een `regelspraak/`-submap met het RegelSpraak-`model.json`.
   De analyse-eenheid is het werkgebied (kennisdomein) met **meerdere
   bronnen** (een bron = `bwbId`+`artikel`+`lid?`), niet één artikel: activiteit 2 markeert per bron,
   activiteit 3 levert één gedeelde, ontdubbelde begrippenlijst over alle bronnen heen. De map heet
   naar de werkgebied-naam (kebab-case); bij ontbreken valt ze terug op de eerste bron
   (`<bwbid>-art<nr>[-lidN]`).
5. **`api/`** — headless FastAPI-backend die dezelfde JAS-werkstroom als async REST-API aanbiedt
   (PostgreSQL-jobstore, per-client bearer-auth). Heeft een eigen `CLAUDE.md` + `README.md` — lees die
   bij werk *in* de API. Het LLM wordt aangestuurd via **benoemde modelprofielen** (in de database, beheerbaar
   via `/v1/admin/profiles`); de env-`LLM_*`-waarden seeden alleen het eerste default-profiel. Een
   analyse kan met feedback-status `akkoord-afronden` al ná activiteit 2 afgerond worden
   (`scope: "act2"`); activiteit 3 volgt dan desgewenst later via `POST /v1/projects/{id}/act3`.
   Naast de analyse biedt de API ook de **RegelSpraak-formaliseringsfase** als on-demand vervolg
   op een afgeronde volledige analyse (`POST /v1/projects/{id}/regelspraak`).
6. **`frontend/`** — Next.js-webapp (BFF) bovenop de API: analyses aanmaken (wet-dropdown met
   **artikel-autocomplete + lid-keuze** via de wetsstructuur, en optioneel een **bestaande
   begrippenlijst** plakken/uploaden als suggestieve act-3-invoer) en reviewen (incl. de knop
   "Akkoord — afronden zonder act. 3" en het later alsnog starten van activiteit 3), een live
   **`/dashboard`** dat alle analyses tot op functieniveau (de engine-stap binnen een state) volgt
   via een aggregate-SSE-stream, en de modelprofielen, de **wet-catalogus** (BWB-id + naam,
   selecteerbaar via dropdown bij een nieuwe analyse) en het token-verbruik beheren via het
   **`/beheer`-scherm** (achter een apart admin-token). De hele webapp zit achter een
   **login met userid + wachtwoord** (Auth.js; e-mail wordt verplicht/uniek geregistreerd maar is
   geen inlog-identiteit; de API is de identiteitsbron, rollen `beheerder`/`analist`, eenmalige
   eerste-beheerder-registratie via `/setup`, optionele TOTP-2FA via `/account`, gebruikersbeheer in
   `/beheer`). De UI volgt de **Rijkshuisstijl**
   (Belastingdienst-stijlvak): lintblauw, Fira-fonts, het officiële Belastingdienst-logo en
   JAS-klassekleuren uit `docs/wa-table.png`. Op een afgeronde analyse kan de gebruiker met
   **"Naar RegelSpraak"** de formaliseringsfase starten en het RegelSpraak-model bekijken/downloaden.
   Heeft een eigen `CLAUDE.md` + `README.md` — lees die bij werk *in* de frontend.

De skill is geen vervanger van de analist: de kern is interpretatiekeuzes **expliciet** maken,
inclusief twijfel en aannames. Brongetrouwheid is niet onderhandelbaar — werk alleen met
letterlijk opgehaalde wettekst, citeer letterlijk, en houd elke markering/begrip/regel
herleidbaar naar artikel + lid + `bronreferentie` (jci-uri).

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

Alle draaiende onderdelen (API, frontend, MCP, chatbot-hop) zijn **geïnstrumenteerd, niet bemeterd**:
ze emitteren gestructureerde JSON-logs (één gedeelde vorm, bron `tools/wettenbank-mcp/src/logger.ts`)
en kunnen OpenTelemetry (traces/metrics/logs) naar een **configureerbaar OTLP-endpoint** sturen
(`OTEL_EXPORTER_OTLP_ENDPOINT`; leeg = alleen logs, nul overhead). Eén trace-id verbindt de keten
frontend → API → MCP/n8n. Een **optionele verzamelstack staat in `deploy/observability/`**:
OTel-Collector + Tempo + Loki + Prometheus, plus **Alloy** dat de stdout-logs van frontend en MCP
naar Loki shipt, een kant-en-klaar **Grafana-dashboard** (`grafana-dashboard-wetsanalyse.json`) en
**alerting** (`alerting/` → n8n-webhook). Je koppelt 'm aan je bestaande Grafana; laat het endpoint
leeg om alles ongewijzigd met alléén JSON-logs te draaien. De volledige uitleg (env-vars, logschema,
AVG-redactie, dashboard/alerting) staat in **`docs/observability.md`**.

## Skills

De wetsanalyse-skill staat in `.claude/skills/wetsanalyse/`; de vervolgskill regelspraak (formaliseren
naar RegelSpraak/GegevensSpraak) in `.claude/skills/regelspraak/`.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code): `handleiding.pages.md`,
`leidraad.pages.md`, en `docs/wetsanalyse-rijk/` (hoofdstukken over JAS en het kader). Raadpleeg
deze bij inhoudelijke vragen over de methode; de skill-`references/` zijn de operationele
samenvatting daarvan.
