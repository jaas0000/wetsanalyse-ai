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
   als afgeleid exportformaat. De skill *gebruikt* de MCP als bron.
3. **`analyses/`** — output: per analyse een map met het eindrapport en de `werk/`-tussenbestanden.
   De map heet naar de BWB-id in kleine letters: `<bwbid>-art<nr>[-lidN]` (bijv.
   `bwbr0004770-art9-lid2`), gelijk aan de bestandsnaam die de rapportgenerator afleidt.
4. **`api/`** — headless FastAPI-backend die dezelfde JAS-werkstroom als async REST-API aanbiedt
   (MongoDB-jobstore, per-client bearer-auth). Heeft een eigen `CLAUDE.md` + `README.md` — lees die
   bij werk *in* de API. Het LLM wordt aangestuurd via **benoemde modelprofielen** (Mongo, beheerbaar
   via `/v1/admin/profiles`); de env-`LLM_*`-waarden seeden alleen het eerste default-profiel.
5. **`frontend/`** — Next.js-webapp (BFF) bovenop de API: analyses aanmaken/reviewen en de
   modelprofielen, de **wet-catalogus** (BWB-id + naam, selecteerbaar via dropdown bij een nieuwe
   analyse) en het token-verbruik beheren via het **`/beheer`-scherm** (achter een apart
   admin-token). Heeft een eigen `CLAUDE.md` + `README.md` — lees die bij werk *in* de frontend.

De skill is geen vervanger van de analist: de kern is interpretatiekeuzes **expliciet** maken,
inclusief twijfel en aannames. Brongetrouwheid is niet onderhandelbaar — werk alleen met
letterlijk opgehaalde wettekst, citeer letterlijk, en houd elke markering/begrip/regel
herleidbaar naar artikel + lid + `bronreferentie` (jci-uri).

## De drie delen hangen via paden samen

Dit is een verzameling losse onderdelen, geen monorepo met één buildsysteem. Het bindmiddel
zijn **projectrelatieve paden**, zodat de map portabel is tussen machines/OS'en:

- `.mcp.json` → **remote HTTP**: `type: "http"`, `url: https://wettenbank-mcp.ipalm.nl/mcp`,
  met `Authorization: Bearer ${WETTENBANK_TOKEN}` (token via env, niet in de repo). De server
  draait als Portainer-stack achter Nginx Proxy Manager — zie `tools/wettenbank-mcp/CLAUDE.md`
  (Deployment). Het lokale **stdio**-alternatief (`command: "node"`,
  `args: ["tools/wettenbank-mcp/dist/index.js"]`) staat daar ook beschreven als fallback.
  Wil iemand buiten dit project alleen het publieke image `ghcr.io/palmw01/wettenbank-mcp`
  draaien, dan is `tools/wettenbank-mcp/HANDLEIDING-IMAGE.md` de beknopte instap.
- `.claude/settings.json` → **gedeeld en gecommit**: bevat een `PreToolUse`-hook die
  `scripts/write_guard.py` aanroept bij elke Write/Edit-tool. De guard blokkeert schrijven
  naar `analyses/*/werk/**/feedback.json` (uitsluitend de review-server schrijft dat) en het
  overschrijven van een bestaande `analyse.json` in `werk/` (voltooide rondes zijn immutabel).
- `.claude/settings.local.json` → `enabledMcpjsonServers: ["wettenbank"]` plus een **machine-lokale**
  allowlist. Dit bestand is **gitignored** (`.gitignore`), dus het reist niet mee en is per definitie
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
- **Activiteit 2 → checkpoint → Activiteit 3 → checkpoint → rapport.** Na elke activiteit
  is er een **iteratief human-in-the-loop review**: de skill schrijft
  `werk/activiteit-{2,3}/ronde-{N}/analyse.json`, draait eerst `scripts/validate_analyse.py`
  als mechanische pre-check (ongeldige JAS-klassen, ontbrekende id's e.d.; exit 2 blokkeert
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
`references/begrippen-en-afleidingsregels-opstellen.md` en `references/verwijzingen-volgen.md`
(het volg-beleid voor cross-referenties: functies, diepte/relevantie-grens, bounded delegaties).
Voorbeeld-output (met `rapport.json`) staat in `analyses/bwbr0004770-art9-lid2/`.

Komt een analyse onbetrouwbaar uit (verzonnen tekst, niet-bestaande klasse, overgeslagen
review, niet-convergerende lus — géén gewone review-feedback), dan is
`references/harness-diagnose.md` de troubleshooting-ingang: het diagnosticeert de skill via
vier hendels (Context, Tools, Loop, Governance) in plaats van het model te verdenken.

## Skills

De wetsanalyse-skill staat in `.claude/skills/wetsanalyse/`.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code): `handleiding.pages.md`,
`leidraad.pages.md`, en `docs/wetsanalyse-rijk/` (hoofdstukken over JAS en het kader). Raadpleeg
deze bij inhoudelijke vragen over de methode; de skill-`references/` zijn de operationele
samenvatting daarvan.
