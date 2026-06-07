# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wat dit project is

Werkruimte voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden van
Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en
het Juridisch Analyseschema (JAS). Het project bestaat uit drie samenwerkende delen:

1. **`tools/wettenbank-mcp/`** — een MCP-server (TypeScript) die de actuele wettekst ophaalt
   via de publieke SRU-API van `overheid.nl`. Dit is de databron. Heeft een eigen, gedetailleerde
   `CLAUDE.md` — lees die bij werk *in* de MCP.
2. **`.claude/skills/wetsanalyse/`** — de inhoudelijke skill die de analyse uitvoert (activiteit 2:
   markeren + classificeren in JAS-klassen; activiteit 3: begrippen + afleidingsregels) en een
   Markdown-analyserapport oplevert. De skill *gebruikt* de MCP als bron.
3. **`analyses/`** — output: per analyse een map met het eindrapport en de `werk/`-tussenbestanden.

De skill is geen vervanger van de analist: de kern is interpretatiekeuzes **expliciet** maken,
inclusief twijfel en aannames. Brongetrouwheid is niet onderhandelbaar — werk alleen met
letterlijk opgehaalde wettekst, citeer letterlijk, en houd elke markering/begrip/regel
herleidbaar naar artikel + lid + `bronreferentie` (jci-uri).

## De drie delen hangen via paden samen

Dit is een verzameling losse onderdelen, geen monorepo met één buildsysteem. Het bindmiddel
zijn **absolute paden** die alle naar déze projectmap moeten wijzen
(`/home/willardp/Documenten/Projecten/wetsanalyse-ai`):

- `.mcp.json` → pad naar `tools/wettenbank-mcp/dist/index.js` (start de MCP-server).
- `.claude/settings.local.json` → `enabledMcpjsonServers: ["wettenbank"]`, plus allow-regels die
  `review_server.py` met absoluut pad aanroepen.
- `.claude/skills/wetsanalyse-workspace/mcp_fetch.py` (`SERVER = ...`) en
  `iteration-1/benchmark.json` (`skill_path`) → eval-artefacten die ook naar deze map verwijzen.

Let op bij hernoemen/verplaatsen van de projectmap: Linux is hoofdlettergevoelig, dus een
verkeerde casing in een pad breekt de MCP stil (`claude mcp list` → `Failed to connect`).
Bij twijfel: `grep -rn "Projecten/" --include="*.json" --include="*.py" . | grep -v node_modules`
en controleer dat elk pad exact `wetsanalyse-ai` is.

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

# MCP direct aanroepen zonder Claude (debug)
python3 .claude/skills/wetsanalyse-workspace/mcp_fetch.py zoek '{"titel":"Wet op de zorgtoeslag"}'
python3 .claude/skills/wetsanalyse-workspace/mcp_fetch.py artikel '{"bwbId":"BWBR0018451","artikel":"2"}'
```

Na het bouwen of wijzigen van de MCP-server: `claude mcp list` om te bevestigen dat hij nog
verbindt voordat je de skill gebruikt.

## De wetsanalyse-skill: werkstroom en checkpoints

De skill (`.claude/skills/wetsanalyse/SKILL.md`) is de gezaghebbende beschrijving. De
kernstructuur die meerdere bestanden raakt:

- **Stap 1** haalt tekst op via de MCP-tools `wettenbank_zoek` → `wettenbank_structuur` →
  `wettenbank_artikel` (en `wettenbank_zoekterm` voor brondefinities in definitieartikelen).
- **Activiteit 2 → checkpoint → Activiteit 3 → checkpoint → rapport.** Na elke activiteit
  is er een **iteratief human-in-the-loop review**: de skill schrijft
  `werk/activiteit-{2,3}/ronde-{N}/analyse.json`, start `scripts/review_server.py` (lokale
  webpagina op poort 3118, alleen stdlib; vanaf ronde 2 met `--ronde N --vorige <ronde-N-1>`),
  pauzeert, en verwerkt daarna `werk/activiteit-{2,3}/ronde-{N}/feedback.json`. Is er feedback,
  dan schrijft de skill een volgende ronde en herhaalt — tot de analist akkoord is zonder
  opmerkingen (veiligheidscap: max. 6 rondes). De skill gaat **niet** zelf door zonder
  bevestiging van de analist. De datacontracten en de lus staan in
  `references/review-checkpoints.md`.
- De review-stops worden alleen overgeslagen als `WETSANALYSE_NO_REVIEW=1` in de omgeving staat
  (uitsluitend voor geautomatiseerde evals).
- Het rapport volgt `assets/analyserapport-sjabloon.md` en eindigt met een **reviewlog** en
  **aandachtspunten voor multidisciplinaire validatie** (open normen, twijfel, aannames).

Inhoudelijke regels die je moet kennen voordat je classificeert of begrippen opstelt:
`references/jas-klassen.md` (de dertien JAS-klassen — verzin er geen), en
`references/activiteit-3-vuistregels.md`. Voorbeeld-output staat in `analyses/iw1990-art9-lid1/`.

## Skills & vendoring

`.claude/skills/skill-creator` is een **symlink** naar `.agents/skills/skill-creator` (gevendord
uit `anthropics/skills`, vastgelegd in `skills-lock.json` met hash). Wijzig die niet handmatig;
gebruik de skill-creator zelf voor wijzigingen aan skills. Evals voor de wetsanalyse-skill staan
in `.claude/skills/wetsanalyse/evals/` (cases in `files/`); de eval-run-output zit in
`.claude/skills/wetsanalyse-workspace/`.

## Referentiedocumentatie

`docs/` bevat de methodische onderbouwing (niet code): `handleiding.pages.md`,
`leidraad.pages.md`, en `docs/wetsanalyse-rijk/` (hoofdstukken over JAS en het kader). Raadpleeg
deze bij inhoudelijke vragen over de methode; de skill-`references/` zijn de operationele
samenvatting daarvan.
