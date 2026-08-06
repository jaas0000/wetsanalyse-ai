# Wetsanalyse AI

Een **agent-platform** voor **Wetsanalyse**: het gestructureerd, brongetrouw en traceerbaar duiden van
Nederlandse wet- en regelgeving volgens de methode Wetsanalyse (Ausems, Bulles & Lokin) en het
Juridisch Analyseschema (JAS).

Het doel is de betekenis van wetgeving expliciet en uitlegbaar te maken, zodat besluiten in de
uitvoering (bijvoorbeeld bij de Belastingdienst) te verantwoorden zijn. Het platform is een
*hulpmiddel voor de jurist*, geen vervanger: **de AI produceert, de mens beoordeelt en corrigeert**.
De kern is interpretatiekeuzes — inclusief twijfel en aannames — zichtbaar maken in plaats van
schijnzekerheid te produceren.

De draaiende kern is een gedeployde dienst: de **wetsanalyse-API**, de **webapp met de werkplek** en de
eigen **QA/annotatie-agent (graph-qa, "de Juridische Assistent")** die op de **BWB-kennisgraaf** (GraphDB)
werkt. De graaf wordt gevuld door de **BWB-importer** (nu in de `palmw01/graphdb`-repo), die de wettekst
rechtstreeks bij overheid.nl ophaalt — er is geen aparte wettenbank-MCP meer. Het geheel draait op Azure
Container Apps én op zelf-gehoste Portainer-stacks.

## Onderdelen

| Onderdeel | Map | Wat het doet |
|-----------|-----|--------------|
| **wetsanalyse-API** | `api/` | Headless FastAPI-backend voor de werkplek: het **JAS-annotatiedomein** (`/v1/annotatie/*`), **login + gebruikersbeheer** (identiteitsbron van de webapp), **LLM-modelprofielbeheer** en de **profiel-keuzelijst**. PostgreSQL-opslag, per-client bearer-auth. *(De oude `/v1/projects`-analyse-pijplijn is verwijderd.)* |
| **frontend + werkplek** | `frontend/` | Next.js-webapp (BFF). De app **is de werkplek** (`/workbench`, de *Assistent-pagina*): één chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, live tegen graph-qa. Plus een uitgekleed **`/beheer`** (modelprofielen, gebruikers, API-tokens). Achter een **login** (userid + wachtwoord, rollen, optionele 2FA). Vormgegeven volgens de **Rijkshuisstijl** (Belastingdienst-stijlvak). |
| **graph-qa — de Juridische Assistent** | `tools/graph-qa/` | De eigen QA/annotatie-agent: beantwoordt vragen over wet- en regelgeving door de BWB-**kennisgraaf** (GraphDB via MCP) te bevragen, brongetrouw onderbouwd. Eén **unified LangGraph-agent** met een supervisor die per vraag kiest tussen de antwoord-worker (specialisten definitie/duiding/algemeen) en de annotatie-worker (ophaal → annoteer → Critic). Endpoints `POST /v1/chat` (SSE) + `GET /v1/artikel`. |
| **observability** | `deploy/observability/` | Optionele verzamelstack (OTel-Collector + Tempo + Loki + Prometheus + Alloy) met kant-en-klare Grafana-dashboards en alerting. Alle onderdelen zijn geïnstrumenteerd (JSON-logs + OpenTelemetry); koppel de stack aan je bestaande Grafana. |
| **skill (legacy/oorsprong)** | `.claude/skills/` | De **interactieve Claude Code-skill** `wetsanalyse` (activiteit 2 → `rapport.json`). Het oorspronkelijke spoor; nog bruikbaar in de CLI en tegelijk de **gedeelde inhoudsbron** (`references/`/`scripts/`) die de API-engine op runtime hergebruikt. |
| **analyses** | `analyses/` | Output van het skill-spoor: per werkgebied een eindrapport plus `werk/`-tussenbestanden. |
| **docs** | `docs/` | Methodische onderbouwing (handleiding, leidraad, het boek, JAS-kader) + `observability.md`. |

## De methode in het kort

Alles is brongetrouw — alleen letterlijk opgehaalde wettekst, alles herleidbaar naar artikel + lid +
bronreferentie (jci-uri). De **werkplek** werkt op de kennisgraaf (graph-qa levert de wettekst). Het
onderstaande beschrijft de **JAS-werkstroom** van het (legacy) interactieve skill-spoor; dat spoor
haalde wettekst via een aparte wettenbank-MCP, die inmiddels is verwijderd (de graaf is nu de bron).

1. **Wettekst ophalen** (skill-spoor, legacy).
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

- **`api/`** — headless FastAPI-backend voor de werkplek: het **JAS-annotatiedomein**
  (`/v1/annotatie/*`: documenten/elementen/beslissingen + append-only auditlog), **login +
  gebruikersbeheer** (de API is de identiteitsbron van de webapp), het **LLM-modelprofielbeheer** en de
  **profiel-keuzelijst** (`/v1/profiles`). PostgreSQL als opslag, per-client bearer-auth. De oude
  `/v1/projects`-analyse-pijplijn (generatie-engine, GraphDB-bron, review-lus, rapport) is **verwijderd**
  nadat de webapp erop uit ging; herbouw van een agentische analyse-flow gebeurt later, elders. Zie
  [`api/README.md`](api/README.md) en [`api/CLAUDE.md`](api/CLAUDE.md).
- **`frontend/`** — Next.js-webapp (BFF). De app **is de werkplek** (`/workbench`, de *Assistent-pagina*):
  één chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, dat live met graph-qa
  (`POST /v1/chat`, SSE) en met de API (`/v1/annotatie/*` voor de persistente state) praat. De home (`/`)
  leidt daarheen door. Daarnaast een uitgekleed **`/beheer`** (modelprofielen, gebruikers, API-tokens).
  De analyse-webapp (analyses aanmaken/reviewen/rapporteren) is **uit de frontend verwijderd**; de
  `POST /v1/projects`-analyse-backend bestaat nog headless in de API. Zie
  [`frontend/README.md`](frontend/README.md).

**Login & toegang.** De hele webapp zit achter een login met **userid + wachtwoord** (Auth.js; de API
is de identiteitsbron). E-mail wordt bij het aanmaken verplicht/uniek geregistreerd maar is geen
inlog-identiteit. Twee rollen: **`beheerder`** (mag `/beheer`, inclusief gebruikersbeheer) en
**`analist`** (de rest). De eerste keer maakt `/setup` eenmalig de eerste beheerder aan; verdere
gebruikers voegt een beheerder toe via `/beheer`. **2FA (TOTP)** is optioneel en self-service via
`/account`. Achter een reverse proxy moet `AUTH_URL` op de publieke origin staan; zie
[`frontend/README.md`](frontend/README.md).

**LLM-beheer.** Taalmodellen leven als **benoemde modelprofielen** in PostgreSQL — runtime te beheren
via het **`/beheer`-scherm** in de webapp (of `GET/PUT /v1/admin/profiles`), zonder redeploy. Je kiest
provider/model/endpoint/temperatuur, slaat de API-key versleuteld op (write-only, nooit teruggegeven),
markeert een default en test de verbinding. De env-`LLM_*`-waarden seeden alleen het eerste
default-profiel. (De QA/annotatie-agent `graph-qa` draait als aparte dienst met een eigen LLM-config.)

**Deployment.** Het platform draait op **Azure Container Apps** (`deploy/azure/`: Postgres, api, graph-qa,
frontend) én als **zelf-gehoste Portainer-stacks** achter Nginx Proxy Manager; CI bouwt de images (GHCR)
en doet de stack-redeploy. De graaf-ingestie (BWB-importer) draait als geplande GitHub Action in de
`palmw01/graphdb`-repo. Detail-instructies staan in de respectievelijke `CLAUDE.md`- en `deploy/`-bestanden.

## Legacy: de skill in Claude Code

Het project begon als een interactieve **wetsanalyse-skill** in Claude Code (`.claude/skills/wetsanalyse/`).
Dat spoor bestaat nog en levert de `references/`/`scripts/` die het platform hergebruikt (o.a. de canonieke
JAS-klassenlijst voor de API). De inhoudelijke regels staan in de skill-`references/`; zie
[`CLAUDE.md`](CLAUDE.md) voor de projectstructuur.

> **Live wettekst ophalen is vervallen.** De skill haalde wettekst via een aparte **wettenbank-MCP**; die
> MCP is verwijderd (de werkplek werkt op de graaf, en de graaf wordt gevuld door de BWB-importer die
> rechtstreeks bij overheid.nl ophaalt). De interactieve fetch-stap van de skill werkt daardoor niet meer;
> het skill-spoor fungeert nu vooral als gedeelde inhoudsbron.

## Databron & licentie

De wettekst komt van de publieke diensten van `overheid.nl` (SRU + BWB-repository); geen API-key nodig,
data is CC-0. De methode Wetsanalyse en het JAS zijn afkomstig uit de Rijksoverheid-publicatie in
`docs/wetsanalyse/wetsanalyse-rijk/` (zie `docs/wetsanalyse/wetsanalyse-rijk/BRON.md` voor de bronvermelding).
