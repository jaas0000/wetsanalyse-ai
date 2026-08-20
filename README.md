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
eigen **QA/annotatie-agent — Lex** (code/image: `graph-qa`) die op de **BWB-kennisgraaf**
(GraphDB) werkt. De graaf wordt gevuld door de **BWB-importer**, die de wettekst rechtstreeks bij
overheid.nl ophaalt. Het geheel draait op de docker-LXC van Proxmox als Portainer-stacks achter Nginx
Proxy Manager.

## Onderdelen

| Onderdeel | Map | Wat het doet |
|-----------|-----|--------------|
| **wetsanalyse-API** | `api/` | Headless FastAPI-backend voor de werkplek: het **JAS-annotatiedomein** (`/v1/annotatie/*`), de **chatgeschiedenis** (`/v1/gesprekken/*`), **login + gebruikersbeheer** (identiteitsbron van de webapp), **LLM-modelprofielbeheer**, de **profiel-keuzelijst**, **berichten** (release notes) en **gebruikersfeedback**. PostgreSQL-opslag, per-client bearer-auth. |
| **frontend + werkplek** | `frontend/` | Next.js-webapp (BFF). De app **is de werkplek** (`/workbench`, de *Lex-pagina*): één chat-achtig gespreksvenster voor **vragen én JAS-annotatie**, live tegen graph-qa. Account, beheer en instellingen openen als dialoog over de werkplek heen. Achter een **login** (userid + wachtwoord, rollen, optionele 2FA). Vormgegeven volgens de **Rijkshuisstijl** (Belastingdienst-stijlvak). |
| **graph-qa — Lex** | `tools/graph-qa/` | De eigen QA/annotatie-agent, die zich naar de gebruiker **Lex** noemt: beantwoordt vragen over wet- en regelgeving door de BWB-**kennisgraaf** (GraphDB via MCP) te bevragen, brongetrouw onderbouwd. Eén **unified LangGraph-agent** met een supervisor die per vraag kiest tussen de antwoord-worker (specialisten definitie/duiding/algemeen) en de annotatie-worker (ophaal → annoteer → Critic). Endpoints: `POST /v1/runs` (+ `/events`, `/cancel`) — de weg van de werkplek, want de beurt draait bij de agent en de browser kijkt mee — plus `POST /v1/chat` (SSE, aan de verbinding gekoppeld) en `GET /v1/artikel`. |
| **BWB-importer** | `tools/bwb-import/` | Haalt de wettekst op bij de BWB-repository van overheid.nl, valideert tegen de officiële XSD's, parseert de structuur en schrijft RDF naar GraphDB. Per wet idempotent; wekelijkse herimport. |
| **de kennisgraaf** | `deploy/graphdb/` | GraphDB 11.4 met repository `inning` en de ingebouwde MCP-server, achter een auth-proxy. Dagelijkse RDF-dump plus de vzdump van de LXC. |
| **observability** | `deploy/observability/` | Verzamelstack (OTel-Collector + Tempo + Loki + Prometheus + Alloy + Grafana) met kant-en-klare dashboards en alerting. Alle onderdelen zijn geïnstrumenteerd (JSON-logs + OpenTelemetry). |
| **skill** | `.claude/skills/wetsanalyse/` | De operationele uitwerking van de JAS-methode: de dertien klassen, het volg-beleid voor verwijzingen, de reviewcontracten. Tevens de **canonieke klassenlijst** die de API op runtime inleest. |
| **docs** | `docs/` | Wat geen code is: de methodische onderbouwing (handleiding, leidraad, het boek, JAS-kader), de RegelSpraak-specificaties, `observability.md`, de schrijfrichtlijn van Lex en de plannen achter de werkbank en de kennisbank. |

## De methode in het kort

Alles is brongetrouw — alleen letterlijk opgehaalde wettekst, alles herleidbaar naar artikel + lid +
bronreferentie (jci-uri). De werkplek werkt op de kennisgraaf; graph-qa levert de wettekst.

1. **Verwijzingen inventariseren & volgen**: de uitgaande verwijzingen van de bepaling (naar het
   definitieartikel, andere leden, schakelbepalingen, gedelegeerde regelingen) opsporen,
   classificeren naar functie, en de relevante volgens beleid volgen (diepte-cap 1 +
   relevantie-gate) — zodat brondefinities en afwijkende hoofdregels brongetrouw meewegen.
2. **Activiteit 2 — markeren & classificeren**: relevante wetsformuleringen markeren en elk een
   van de dertien JAS-klassen geven (rechtssubject, rechtsbetrekking, voorwaarde, afleidingsregel, …).
3. **Review**: de analist beoordeelt elk voorgesteld element (goedkeuren, bijstellen, afwijzen) en
   elke beslissing landt in een append-only auditlog.

> **Scope: activiteit 2.** Begrippen (activiteit 3) en de RegelSpraak-formalisering horen niet tot de
> huidige functionaliteit; die worden later op een **agentische** basis gebouwd.

Het review is bewust **iteratief en human-in-the-loop**: de agent stelt voor, de mens beslist, en de
agent (de **Critic**) markeert per element hoeveel aandacht het verdient. Een mechanische pre-check
bewaakt vooraf de harde eisen — geldige JAS-klassen, stabiele id's, letterlijke citaten.

## Het platform gebruiken

- **`api/`** — zie [`api/README.md`](api/README.md) en [`api/CLAUDE.md`](api/CLAUDE.md).
- **`frontend/`** — zie [`frontend/README.md`](frontend/README.md).
- **`tools/graph-qa/`** — zie [`tools/graph-qa/README.md`](tools/graph-qa/README.md).

**Login & toegang.** De hele webapp zit achter een login met **userid + wachtwoord** (Auth.js; de API
is de identiteitsbron). E-mail wordt bij het aanmaken verplicht/uniek geregistreerd maar is geen
inlog-identiteit. Twee rollen: **`beheerder`** (mag de beheertab, inclusief gebruikersbeheer) en
**`analist`** (de rest). De eerste keer maakt `/setup` eenmalig de eerste beheerder aan; verdere
gebruikers voegt een beheerder toe. **2FA (TOTP)** is optioneel en self-service. Achter een reverse
proxy moet `AUTH_URL` op de publieke origin staan; zie [`frontend/README.md`](frontend/README.md).

**LLM-beheer.** Taalmodellen leven als **benoemde modelprofielen** in PostgreSQL — runtime te beheren
via de beheertab in de webapp (of `GET/PUT /v1/admin/profiles`), zonder redeploy. Je kiest
provider/model/endpoint/temperatuur, slaat de API-key versleuteld op (write-only, nooit teruggegeven),
markeert een default en test de verbinding. De env-`LLM_*`-waarden seeden alleen het eerste
default-profiel. De QA/annotatie-agent graph-qa draait als aparte dienst met een eigen LLM-config.

**Uitrollen.** CI bouwt de images naar GHCR met een audit vooraf en een Trivy-gate achteraf. Uitrollen
is een aparte, expliciete stap: `dev-deploy` voor de dev-omgeving
(https://dev.wetsanalyse.ipalm.nl), `deploy-graaf` voor de graaf en de importer,
`deploy-observability` voor de verzamelstack. Details staan in de `deploy/`-READMEs.

## Databron & licentie

De wettekst komt van de publieke diensten van `overheid.nl` (SRU + BWB-repository); geen API-key nodig,
data is CC-0. De methode Wetsanalyse en het JAS zijn afkomstig uit de Rijksoverheid-publicatie in
`docs/wetsanalyse/wetsanalyse-rijk/` (zie `docs/wetsanalyse/wetsanalyse-rijk/BRON.md` voor de bronvermelding).
