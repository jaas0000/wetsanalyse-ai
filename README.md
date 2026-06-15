# Wetsanalyse AI

Werkruimte voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden van
Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS).

Het doel is de betekenis van wetgeving expliciet en uitlegbaar te maken, zodat besluiten in de
uitvoering (bijvoorbeeld bij de Belastingdienst) te verantwoorden zijn. De analyse is een
*hulpmiddel voor de analist*, geen vervanger: de kern is interpretatiekeuzes — inclusief twijfel
en aannames — zichtbaar maken in plaats van schijnzekerheid te produceren.

## Onderdelen

| Onderdeel | Map | Wat het doet |
|-----------|-----|--------------|
| **wettenbank-MCP** | `tools/wettenbank-mcp/` | MCP-server (TypeScript) die actuele wettekst ophaalt via de publieke SRU-API van `overheid.nl`. De databron. |
| **wetsanalyse-skill** | `.claude/skills/wetsanalyse/` | Voert de analyse uit (activiteit 2 + 3) en levert een `rapport.json` op die via een lokale HTML-viewer wordt getoond. Markdown is beschikbaar als export. Gebruikt de MCP als bron. |
| **wetsanalyse-api** | `api/` | Headless REST-backend (FastAPI) die dezelfde werkstroom als de skill aanbiedt als async API, met MongoDB als jobstore. Stuurt de LLM aan via beheerbare modelprofielen. |
| **frontend** | `frontend/` | Webapp (Next.js) bovenop de API: analyse aanmaken, live voortgang, de review-lus, het rapport, een live **`/dashboard`** (alle analyses tot op functieniveau), en een **`/beheer`-scherm** om de LLM-modelprofielen en het token-verbruik te beheren. |
| **analyses** | `analyses/` | Output: per analyse een eindrapport plus `werk/`-tussenbestanden. |
| **docs** | `docs/` | Methodische onderbouwing (handleiding, leidraad, JAS-kader). |

Er zijn dus **twee manieren** om een analyse te draaien: interactief via de wetsanalyse-skill in
Claude Code (skill + MCP + `analyses/`), of als dienst via de **API + webapp** (`api/` + `frontend/`).
Beide hergebruiken dezelfde inhoudelijke `references/` en `scripts/` van de skill.

## De methode in het kort

De skill werkt brongetrouw — alleen letterlijk opgehaalde wettekst, alles herleidbaar naar
artikel + lid + bronreferentie — en doorloopt:

1. **Wettekst ophalen** via de MCP (`wettenbank_zoek` → `wettenbank_structuur` → `wettenbank_artikel`).
1b. **Verwijzingen inventariseren & volgen**: de uitgaande verwijzingen van de bepaling (naar het
   definitieartikel, andere leden, schakelbepalingen, gedelegeerde regelingen) opsporen,
   classificeren naar functie, en de relevante volgens beleid volgen (diepte-cap 1 +
   relevantie-gate) — zodat brondefinities en afwijkende hoofdregels brongetrouw meewegen.
2. **Activiteit 2 — markeren & classificeren**: relevante wetsformuleringen markeren en elk een
   van de dertien JAS-klassen geven (rechtssubject, rechtsbetrekking, voorwaarde, afleidingsregel, …).
3. **Activiteit 3 — betekenis vaststellen**: begrippen (met definitie, voorbeeld, relaties) en
   afleidingsregels (beslis-, reken- en specialisatieregels) vastleggen.
4. **Rapport** — `rapport.json` als primaire bron, gepresenteerd via een lokale HTML-viewer
   (poort 3119) met bewerkbare §4-velden en een exportknop voor Markdown.

Na activiteit 2 én na activiteit 3 is er een **iteratief human-in-the-loop review-checkpoint**:
een lokale reviewpagina waarin de analist de tussenresultaten per onderdeel valideert en feedback
geeft. De skill verwerkt die feedback en toont het herziene resultaat in een nieuwe ronde — met
per item de vorige versie en de eerder gegeven feedback ernaast, zodat zichtbaar is of een
correctie geland is. Dit herhaalt tot de analist akkoord is zonder opmerkingen (met een
veiligheidscap op het aantal rondes). Elke ronde wordt bewaard onder `werk/activiteit-N/ronde-M/`
voor een volledig auditspoor.

Vóór elke reviewronde draait een mechanische **pre-check** (`validate_analyse.py`) die de
tussenresultaten valideert — geldige JAS-klassen, stabiele id's, letterlijke citaten — en
blokkeert bij fouten. Voltooide rondes zijn bovendien **immutabel**: een write-guard-hook
(`.claude/settings.json`) voorkomt dat een bestaande `analyse.json` of `feedback.json` wordt
overschreven, zodat het auditspoor betrouwbaar blijft.

## Aan de slag

De wettenbank-MCP is standaard een **remote HTTP-server** (`.mcp.json` → `https://wettenbank-mcp.ipalm.nl/mcp`).
Je hoeft niets te bouwen; zet alleen het toegangstoken in de omgeving:

```bash
export WETTENBANK_TOKEN=<jouw-token>   # gaat als 'Authorization: Bearer' mee
```

Controleer dat Claude Code de server ziet:

```bash
claude mcp list    # verwacht: wettenbank → ✓ Connected (HTTP)
```

> **Lokaal draaien (fallback).** Wil je de MCP-server zelf draaien i.p.v. de remote endpoint,
> bouw hem dan en zet `.mcp.json` op het stdio-alternatief (zie `tools/wettenbank-mcp/CLAUDE.md`):
>
> ```bash
> cd tools/wettenbank-mcp
> npm install
> npm run build      # TypeScript → dist/
> npm test           # vitest
> ```

Vraag daarna in Claude Code om een wetsanalyse van een artikel (bijvoorbeeld *"doe een
wetsanalyse van artikel 9 lid 1 Invorderingswet 1990"*); de wetsanalyse-skill haalt de tekst
zelf op en doorloopt de werkstroom. Zie [`CLAUDE.md`](CLAUDE.md) voor de projectstructuur en
de skill-`references/` voor de inhoudelijke regels (o.a. de JAS-klassen).

## Webapp & API

Naast de skill kun je de analyse als zelfstandige dienst draaien:

- **`api/`** — headless FastAPI-backend met dezelfde JAS-werkstroom als async REST-API
  (`POST /v1/projects` → polling/SSE), MongoDB als jobstore, en per-client bearer-auth. Zie
  [`api/README.md`](api/README.md) en [`api/CLAUDE.md`](api/CLAUDE.md).
- **`frontend/`** — Next.js-webapp (BFF) erbovenop: analyses aanmaken, voortgang volgen, de
  human-in-the-loop review-lus, het rapport bekijken, en een live **`/dashboard`** dat alle analyses
  tot op functieniveau (de engine-stap binnen een state) toont. Zie [`frontend/README.md`](frontend/README.md).

**LLM-beheer.** Welk taalmodel de analyses gebruiken, leeft in **benoemde modelprofielen** in
MongoDB — runtime te beheren via het **`/beheer`-scherm** in de webapp (of `GET/PUT /v1/admin/profiles`),
zonder redeploy. Je kiest provider/model/endpoint/temperatuur, slaat de API-key versleuteld op
(write-only, nooit teruggegeven), markeert een default, test de verbinding, en ziet het
token-verbruik per model/profiel. Bij een nieuwe analyse kies je het profiel uit een dropdown die
de profielen live ophaalt. Het admin-scherm zit achter een **apart admin-token**. De env-`LLM_*`-waarden
seeden alleen het eerste default-profiel.

Beide draaien als Docker/Portainer-stacks achter Nginx Proxy Manager (CI bouwt de images en doet de
stack-redeploy); de detail-instructies staan in de respectievelijke `CLAUDE.md`-bestanden.

## Databron & licentie

De wettekst komt van de publieke diensten van `overheid.nl` (SRU + BWB-repository); geen API-key
nodig, data is CC-0. De methode Wetsanalyse en het JAS zijn afkomstig uit de Rijksoverheid-publicatie
in `docs/wetsanalyse-rijk/` (zie `docs/wetsanalyse-rijk/BRON.md` voor de bronvermelding).
