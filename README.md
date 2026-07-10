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
| **regelspraak-skill** | `.claude/skills/regelspraak/` | Vervolgskill: formaliseert de geduide begrippen + afleidingsregels naar **RegelSpraak + GegevensSpraak** (Belastingdienst/ALEF). Levert een `model.json` (HTML-viewer; `.rs`/Markdown als export). Werkt vanuit een afgerond `rapport.json` of standalone vanaf wettekst. |
| **wetsanalyse-api** | `api/` | Headless REST-backend (FastAPI) die dezelfde werkstroom als de skill aanbiedt als async API, met PostgreSQL als jobstore. Stuurt de LLM aan via beheerbare modelprofielen. Biedt ook de RegelSpraak-formaliseringsfase als on-demand vervolg (`POST /v1/projects/{id}/regelspraak`). |
| **frontend** | `frontend/` | Webapp (Next.js) bovenop de API: analyse aanmaken, live voortgang, de review-lus, het rapport, de **RegelSpraak-fase** (knop "Naar RegelSpraak" + model-weergave), een live **`/dashboard`** (alle analyses tot op functieniveau), en een **`/beheer`-scherm** om LLM-modelprofielen, gebruikers en token-verbruik te beheren. Zit achter een **login** (userid + wachtwoord, rollen, optionele 2FA). Vormgegeven volgens de **Rijkshuisstijl** (Belastingdienst-stijlvak). |
| **kennisgraaf** | `tools/kennisgraaf/` | 3D-verwijzingsgraaf van de JCI-links in de Invorderingswet 1990 + Leidraad Invordering 2008, met zoekpaneel (artikel + lid). Open het standalone HTML-bestand of draai `npm run serve` (poort 4567); graaf-data hergenereren via `npm run extract` → `graph.json` → `npm run bundle`. |
| **analyses** | `analyses/` | Output: per analyse een eindrapport plus `werk/`-tussenbestanden (en desgewenst een `regelspraak/`-submap met het RegelSpraak-`model.json`). |
| **deploy** | `deploy/openshift/` | Kustomize-manifests om de hele stack (API · frontend · MCP · PostgreSQL) op OpenShift uit te rollen (overlays `local`/`simpel`/`beproeving`/`managed-prod`); zie `deploy/openshift/INSTALL.md`. |
| **docs** | `docs/` | Methodische onderbouwing (handleiding, leidraad, JAS-kader) + `docs/architectuur/` (interactieve architectuurplaat en het kennisgraaf/GraphRAG-ontwerpdoc). |

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
3. **Activiteit 3 — betekenis vaststellen**: eerst de begrippen (3a: definitie, voorbeeld,
   relaties, gekoppeld aan de activiteit-2-markeringen waarop ze berusten), daarna de
   afleidingsregels (3b: beslis-, reken- en specialisatieregels) — met de begrippen als
   **bouwstenen**: uitvoer, invoer, parameters en voorwaarden verwijzen per begrip-id. Een
   bestaande begrippenlijst kan als suggestieve invoer worden aangeleverd; per begrip wordt
   dan de herkomst geregistreerd (hergebruikt/aangepast/nieuw). Een afleidingsregel wordt
   *geannoteerd*; de uitvoerbare formulering volgt pas in de regelspraak-stap, zodat er één
   bron van waarheid voor de regel is. Desgewenst kan de analyse ook al ná activiteit 2
   worden afgerond en activiteit 3 later alsnog draaien.
4. **Rapport** — `rapport.json` als primaire bron, gepresenteerd via een lokale HTML-viewer
   (poort 3119) met bewerkbare §4-velden en een exportknop voor Markdown.
5. **RegelSpraak (optioneel vervolg)** — de regelspraak-skill zet het rapport om naar GegevensSpraak +
   RegelSpraak-regels, opnieuw met twee review-checkpoints (poort 3120) en een `model.json` + viewer
   (poort 3121) en `.rs`/Markdown-export.

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

Wil je de uitkomst formaliseren, vraag dan om *"zet deze wetsanalyse om naar RegelSpraak"*; de
regelspraak-skill leest het `rapport.json` in en bouwt het objectmodel + de regels.

## Webapp & API

Naast de skill kun je de analyse als zelfstandige dienst draaien:

- **`api/`** — headless FastAPI-backend met dezelfde JAS-werkstroom als async REST-API
  (`POST /v1/projects` → polling/SSE), PostgreSQL als jobstore, en per-client bearer-auth. Een
  analyse kan ook al na activiteit 2 worden afgerond (`scope: "act2"`); activiteit 3 volgt dan
  desgewenst later via `POST /v1/projects/{id}/act3`. Op een afgeronde analyse start
  `POST /v1/projects/{id}/regelspraak` de RegelSpraak-formaliseringsfase
  (eigen artefact via `GET …/regelspraak`, met `.rs`/`.md`-export). Zie
  [`api/README.md`](api/README.md) en [`api/CLAUDE.md`](api/CLAUDE.md).
- **`frontend/`** — Next.js-webapp (BFF) erbovenop: analyses aanmaken (wet-dropdown met
  **artikel-autocomplete + lid-keuze**, en optioneel een **bestaande begrippenlijst** plakken of
  uploaden als suggestieve act-3-invoer), voortgang volgen, de
  human-in-the-loop review-lus, het rapport bekijken, de **RegelSpraak-fase** starten en het model
  bekijken/downloaden, en een live **`/dashboard`** dat alle analyses
  tot op functieniveau (de engine-stap binnen een state) toont. Vormgegeven volgens de
  **Rijkshuisstijl** (Belastingdienst-stijlvak). Zie [`frontend/README.md`](frontend/README.md).

**Login & toegang.** De hele webapp zit achter een login met **userid + wachtwoord** (Auth.js; de
API is de identiteitsbron). E-mail wordt bij het aanmaken verplicht/uniek geregistreerd maar is geen
inlog-identiteit. Twee rollen: **`beheerder`** (mag `/beheer`, inclusief gebruikersbeheer) en
**`analist`** (de rest). De eerste keer maakt `/setup` eenmalig de eerste beheerder aan; verdere
gebruikers voegt een beheerder toe via `/beheer` (met een eenmalig tijdelijk wachtwoord). **2FA
(TOTP)** is optioneel en self-service via `/account`. Achter een reverse proxy moet `AUTH_URL` op de
publieke origin staan; zie [`frontend/README.md`](frontend/README.md).

**LLM-beheer.** Welk taalmodel de analyses gebruiken, leeft in **benoemde modelprofielen** in
PostgreSQL — runtime te beheren via het **`/beheer`-scherm** in de webapp (of `GET/PUT /v1/admin/profiles`),
zonder redeploy. Je kiest provider/model/endpoint/temperatuur, slaat de API-key versleuteld op
(write-only, nooit teruggegeven), markeert een default, test de verbinding, en ziet het
token-verbruik per model/profiel. Bij een nieuwe analyse kies je het profiel uit een dropdown die
de profielen live ophaalt. Het admin-scherm zit achter een **apart admin-token**. De env-`LLM_*`-waarden
seeden alleen het eerste default-profiel.

Beide draaien als Docker/Portainer-stacks achter Nginx Proxy Manager (CI bouwt de images en doet de
stack-redeploy); de detail-instructies staan in de respectievelijke `CLAUDE.md`-bestanden. Daarnaast
is er een **OpenShift-pad**: `deploy/openshift/` bevat Kustomize-manifests voor de hele stack op een
namespace van een gedeeld cluster (overlays `local`/`simpel`/`beproeving`/`managed-prod`, database
via kale Postgres of de CloudNativePG-operator) — zie [`deploy/openshift/INSTALL.md`](deploy/openshift/INSTALL.md).

## Databron & licentie

De wettekst komt van de publieke diensten van `overheid.nl` (SRU + BWB-repository); geen API-key
nodig, data is CC-0. De methode Wetsanalyse en het JAS zijn afkomstig uit de Rijksoverheid-publicatie
in `docs/wetsanalyse-rijk/` (zie `docs/wetsanalyse-rijk/BRON.md` voor de bronvermelding).
