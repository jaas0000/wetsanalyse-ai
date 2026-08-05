# Wetsanalyse AI

Een **agent-platform** voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden van
Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS).

Het doel is de betekenis van wetgeving expliciet en uitlegbaar te maken, zodat besluiten in de
uitvoering (bijvoorbeeld bij de Belastingdienst) te verantwoorden zijn. Het platform is een
*hulpmiddel voor de jurist*, geen vervanger: **de AI produceert, de mens beoordeelt en corrigeert**.
De kern is interpretatiekeuzes — inclusief twijfel en aannames — zichtbaar maken in plaats van
schijnzekerheid te produceren.

De draaiende kern is een gedeployde dienst: de **wetsanalyse-API**, de **webapp met de werkplek**, de
eigen **QA/annotatie-agent (graph-qa, "de Juridische Assistent")** en de **wettenbank-MCP** als
databron. Het geheel draait op Azure Container Apps én op zelf-gehoste Portainer-stacks.

## Onderdelen

| Onderdeel | Map | Wat het doet |
|-----------|-----|--------------|
| **wettenbank-MCP** | `tools/wettenbank-mcp/` | MCP-server (TypeScript) die actuele wettekst ophaalt via de publieke SRU-API van `overheid.nl`. De databron voor het hele platform. |
| **wetsanalyse-API** | `api/` | Headless FastAPI-backend met de JAS-werkstroom (**activiteit 2**) als async REST-API (`POST /v1/projects` → polling/SSE), PostgreSQL-jobstore en per-client bearer-auth. De act-2-generatie is **agentisch op GraphDB** (agent⇄tools; de wettenbank-MCP-pijplijn blijft als rollback). Ook het annotatie-domein van de werkplek (`/v1/annotatie/*`). Stuurt het LLM aan via beheerbare modelprofielen. |
| **frontend + werkplek** | `frontend/` | Next.js-webapp (BFF). Twee gezichten: de **analyse-webapp** (analyse aanmaken, live agent-voortgang, review-lus, rapport, `/beheer`) en **de werkplek** (`/workbench`, de *Assistent-pagina*) — één gespreksvenster voor **vragen én JAS-annotatie**, live tegen graph-qa. Achter een **login** (userid + wachtwoord, rollen, optionele 2FA). Vormgegeven volgens de **Rijkshuisstijl** (Belastingdienst-stijlvak). |
| **graph-qa — de Juridische Assistent** | `tools/graph-qa/` | De eigen QA/annotatie-agent: beantwoordt vragen over wet- en regelgeving door de BWB-**kennisgraaf** (GraphDB via MCP) te bevragen, brongetrouw onderbouwd. Eén **unified LangGraph-agent** met een supervisor die per vraag kiest tussen de antwoord-worker (specialisten definitie/duiding/algemeen) en de annotatie-worker (ophaal → annoteer → Critic). Endpoints `POST /v1/chat` (SSE) + `GET /v1/artikel`. |
| **observability** | `deploy/observability/` | Optionele verzamelstack (OTel-Collector + Tempo + Loki + Prometheus + Alloy) met kant-en-klare Grafana-dashboards en alerting. Alle onderdelen zijn geïnstrumenteerd (JSON-logs + OpenTelemetry); koppel de stack aan je bestaande Grafana. |
| **skill (legacy/oorsprong)** | `.claude/skills/` | De **interactieve Claude Code-skill** `wetsanalyse` (activiteit 2 → `rapport.json`). Het oorspronkelijke spoor; nog bruikbaar in de CLI en tegelijk de **gedeelde inhoudsbron** (`references/`/`scripts/`) die de API-engine op runtime hergebruikt. |
| **analyses** | `analyses/` | Output van het skill-spoor: per werkgebied een eindrapport plus `werk/`-tussenbestanden. |
| **docs** | `docs/` | Methodische onderbouwing (handleiding, leidraad, het boek, JAS-kader) + `observability.md`. |

## De methode in het kort

Alles is brongetrouw — alleen letterlijk opgehaalde wettekst, alles herleidbaar naar artikel + lid +
bronreferentie (jci-uri) — en volgt de JAS-werkstroom:

1. **Wettekst ophalen** via de wettenbank-MCP (`wettenbank_zoek` → `wettenbank_structuur` →
   `wettenbank_artikel`).
1b. **Verwijzingen inventariseren & volgen**: de uitgaande verwijzingen van de bepaling (naar het
   definitieartikel, andere leden, schakelbepalingen, gedelegeerde regelingen) opsporen,
   classificeren naar functie, en de relevante volgens beleid volgen (diepte-cap 1 +
   relevantie-gate) — zodat brondefinities en afwijkende hoofdregels brongetrouw meewegen.
2. **Activiteit 2 — markeren & classificeren**: relevante wetsformuleringen markeren en elk een
   van de dertien JAS-klassen geven (rechtssubject, rechtsbetrekking, voorwaarde, afleidingsregel, …).
3. **Rapport** — `rapport.json` als primaire bron, gepresenteerd via een HTML-viewer met bewerkbare
   §3-velden (reviewlog + aandachtspunten) en een Markdown-export.

> **Scope: alleen activiteit 2.** Begrippen (activiteit 3) en de RegelSpraak-formaliseringsfase zijn uit
> het platform verwijderd en worden later op een **agentische** basis herbouwd.

Na activiteit 2 is er een **iteratief human-in-the-loop review-checkpoint**: de
analist valideert de tussenresultaten per onderdeel en geeft feedback; het herziene resultaat volgt in
een nieuwe ronde — met per item de vorige versie en de eerder gegeven feedback ernaast — tot de
analist akkoord is (met een veiligheidscap op het aantal rondes). Elke ronde wordt bewaard voor een
volledig auditspoor, en een mechanische **pre-check** valideert vooraf (geldige JAS-klassen, stabiele
id's, letterlijke citaten).

## Het platform gebruiken (API + webapp)

- **`api/`** — headless FastAPI-backend met de JAS-werkstroom (**activiteit 2**) als async REST-API
  (`POST /v1/projects` → polling/SSE), PostgreSQL als jobstore, en per-client bearer-auth. De
  act-2-generatie is **agentisch op GraphDB** (agent⇄tools op de job-modelprofiel-LLM; de
  wettenbank-MCP-pijplijn blijft als rollback via `WETSANALYSE_ACT2_ENGINE`), met een behouden harde gate
  (brongetrouwheid + JAS-schema). Een analyse rondt act2-only af (`scope: "act2"`). Daarnaast bedient de
  API de **werkplek** met het annotatie-domein (`/v1/annotatie/*`). Begrippen (activiteit 3) en
  RegelSpraak zijn verwijderd en worden later op een agentische basis herbouwd. Zie
  [`api/README.md`](api/README.md) en [`api/CLAUDE.md`](api/CLAUDE.md).
- **`frontend/`** — Next.js-webapp (BFF). De **analyse-webapp**: analyses aanmaken (wet-dropdown met
  **artikel-autocomplete + lid-keuze**), live agent-voortgang volgen, de review-lus en het rapport.
  **De werkplek** (`/workbench`): één Assistent-pagina voor **vragen én JAS-annotatie**, die live met
  graph-qa (`POST /v1/chat`, SSE) en met de API (`/v1/annotatie/*` voor de persistente state) praat. Het
  live overzicht van álle analyses draait in het Grafana-dashboard *"Wetsanalyse — systeemtopologie"*
  (`deploy/observability/`). Zie [`frontend/README.md`](frontend/README.md).

**Login & toegang.** De hele webapp zit achter een login met **userid + wachtwoord** (Auth.js; de API
is de identiteitsbron). E-mail wordt bij het aanmaken verplicht/uniek geregistreerd maar is geen
inlog-identiteit. Twee rollen: **`beheerder`** (mag `/beheer`, inclusief gebruikersbeheer) en
**`analist`** (de rest). De eerste keer maakt `/setup` eenmalig de eerste beheerder aan; verdere
gebruikers voegt een beheerder toe via `/beheer`. **2FA (TOTP)** is optioneel en self-service via
`/account`. Achter een reverse proxy moet `AUTH_URL` op de publieke origin staan; zie
[`frontend/README.md`](frontend/README.md).

**LLM-beheer.** Welk taalmodel de analyses gebruiken, leeft in **benoemde modelprofielen** in
PostgreSQL — runtime te beheren via het **`/beheer`-scherm** in de webapp (of `GET/PUT /v1/admin/profiles`),
zonder redeploy. Je kiest provider/model/endpoint/temperatuur, slaat de API-key versleuteld op
(write-only, nooit teruggegeven), markeert een default, test de verbinding, en ziet het
token-verbruik per model/profiel. De env-`LLM_*`-waarden seeden alleen het eerste default-profiel.

**Deployment.** Het platform draait op **Azure Container Apps** (`deploy/azure/`: Postgres, wettenbank-mcp,
api, graph-qa, frontend) én als **zelf-gehoste Portainer-stacks** achter Nginx Proxy Manager; CI bouwt de
images (GHCR) en doet de stack-redeploy. Detail-instructies staan in de respectievelijke `CLAUDE.md`- en
`deploy/`-bestanden.

## Legacy: de skill in Claude Code

Het project begon als een interactieve **wetsanalyse-skill** in Claude Code. Dat spoor bestaat nog en
werkt standalone, en levert bovendien de `references/`/`scripts/` die het platform hergebruikt.

De wettenbank-MCP is standaard een **remote HTTP-server** (`.mcp.json` → `https://wettenbank-mcp.ipalm.nl/mcp`);
zet alleen het toegangstoken in de omgeving en controleer dat Claude Code de server ziet:

```bash
export WETTENBANK_TOKEN=<jouw-token>   # gaat als 'Authorization: Bearer' mee
claude mcp list                        # verwacht: wettenbank → ✓ Connected (HTTP)
```

Vraag daarna in Claude Code om een wetsanalyse (bijvoorbeeld *"doe een wetsanalyse van artikel 9 lid 1
Invorderingswet 1990"*); de skill haalt de tekst zelf op, doorloopt de activiteit-2-werkstroom met een
review-checkpoint en levert een `rapport.json` (HTML-viewer + Markdown-export). Zie
[`CLAUDE.md`](CLAUDE.md) voor de projectstructuur en de skill-`references/` voor de inhoudelijke regels
(o.a. de JAS-klassen).

> **Lokaal draaien (fallback).** Wil je de MCP-server zelf draaien i.p.v. de remote endpoint, bouw hem dan
> en zet `.mcp.json` op het stdio-alternatief (zie `tools/wettenbank-mcp/CLAUDE.md`): `cd tools/wettenbank-mcp
> && npm install && npm run build && npm test`.

## Databron & licentie

De wettekst komt van de publieke diensten van `overheid.nl` (SRU + BWB-repository); geen API-key nodig,
data is CC-0. De methode Wetsanalyse en het JAS zijn afkomstig uit de Rijksoverheid-publicatie in
`docs/wetsanalyse/wetsanalyse-rijk/` (zie `docs/wetsanalyse/wetsanalyse-rijk/BRON.md` voor de bronvermelding).
