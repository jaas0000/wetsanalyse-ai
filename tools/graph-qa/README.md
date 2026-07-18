# graph-qa

Een vraag-antwoorddienst voor **Nederlandse invorderings- en belastingwetgeving** die in een
**GraphDB-kennisgraaf** is opgeslagen. `graph-qa` beantwoordt een natuurlijke-taalvraag door die graaf
te bevragen en het antwoord **uitsluitend** te baseren op wat de graaf teruggeeft — met een
letterlijke vindplaats (regeling / artikel / lid) en een bronnenlijst die herleidbaar is tot de
daadwerkelijk uitgevoerde queries. Het is een Python/FastAPI-dienst; de agentlogica draait op een
LangGraph-toestandsmachine met een LLM (Anthropic via Azure AI Foundry).

## Wat de agent doet

De kern is **brongetrouwheid**: het model mag niet uit eigen kennis antwoorden. Voor elke inhoudelijke
vraag bevraagt de agent eerst de graaf via een **getypeerde toollaag**, en een aparte controlestap
verifieert achteraf dat elke citaat in het antwoord ook echt uit een tool-resultaat komt. Vragen die
niet over de wetgeving in de graaf gaan, worden beleefd afgewezen.

Eén vraag doorloopt een vaste keten (een LangGraph-graaf):

1. **Router** — één LLM-call bepaalt welke *specialist* de vraag behandelt en schetst kort de aanpak;
   een vraag buiten het onderwerp wordt hier al afgewezen.
2. **Specialist (reason ↔ retrieve)** — de gekozen specialist redeneert en roept tools aan; de agent
   voert die uit tegen de graaf en voegt de resultaten toe aan een *tool-trace*. Dit herhaalt tot er
   geen tool-aanroep meer volgt (of tot een beurten-limiet).
3. **Verify (grounding)** — deterministische controle of de vindplaatsen in het antwoord voorkomen in
   de tool-trace. Niet-onderbouwde citaten worden gemarkeerd; desgewenst volgt één corrigerende
   her-vraag.
4. **Finalize** — de bronnenlijst wordt uit de tool-trace opgebouwd en beperkt tot de in het antwoord
   aangehaalde regelingen; het antwoord, de bronnen en het grounding-oordeel worden uitgestuurd.

### Specialisten (multi-agent supervisor)

De router kiest per vraag één specialist; elk krijgt een eigen instructie én een **subset** van de
tools:

| Specialist | Waarvoor | Kern-tools |
|---|---|---|
| `definitie` | Begrippen en definities herleiden en letterlijk citeren. | `resolve_begrip`, `get_artikel`/`get_lid`, `search_wetgeving`/`semantic_search` |
| `duiding` | Betekenis, structuur en samenhang van een bepaling; kruisverwijzingen volgen. | `get_context`, `follow_verwijzingen`, `referenced_by`, `get_artikel`/`get_lid` |
| `algemeen` | Overige juridische vragen. | Alle tools |

### De toollaag (retrieval)

Het model krijgt **geen** vrije SPARQL, maar een set van twaalf getypeerde tools; alleen `raw_sparql`
is een afgeschermd laatste redmiddel:

- **Zoeken** — `search_wetgeving` (full-text/Lucene, exacte termen) en `semantic_search` (op betekenis,
  via een GraphDB-similarity-index; te combineren als hybride zoekstap).
- **Ophalen** — `get_artikel`, `get_lid`.
- **Regelingen** — `list_regelingen`, `get_regeling_info` (soort, geldigheid, uitgevende organisatie).
- **Verwijzingen** — `follow_verwijzingen` (uitgaand), `referenced_by` (inkomend).
- **Context (GraphRAG)** — `get_context`: een bepaling mét haar bevattende delen, leden en
  verwijzingen in één query.
- **Begrippen** — `resolve_begrip` (SKOS-thesaurus).
- **Introspectie** — `graph_schema` (live omvang van de graaf).
- **Laatste redmiddel** — `raw_sparql` (read-only SELECT/CONSTRUCT/DESCRIBE).

### Brongetrouwheid, expliciet gemaakt

- **Bronnen uit de tool-trace, niet uit modeltekst.** De vindplaatsen (BWB-IRI's, jci-strings,
  BWB-id's) worden herkend in wat de graaf terugstuurde — een geparafraseerde of verzonnen citaat in
  de prozatekst wordt zo nooit als "bron" gepresenteerd.
- **Grounding-controle.** Deterministisch (geen extra LLM-call): een citaat geldt als onderbouwd zodra
  zijn BWB-id ergens in de opgehaalde tekst voorkomt; anders wordt het als *unsupported* gemeld.
- **Onderwerp-afbakening en injectie-weerbaarheid.** De agent behandelt tekst die uit de graaf komt
  als data, nooit als instructie, en houdt zich aan de scope ook als een bericht vraagt dat te negeren.

### Geheugen

Gesprekscontinuïteit loopt via een durable LangGraph-checkpointer (sleutel = het meegegeven
gespreks-/sessie-id). Naast de episodische berichten houdt de agent een set eerder geraadpleegde
bepalingen bij; die dient als aanknopingspunt voor verwijzingen als "dat artikel" — feiten worden
altijd opnieuw via de tools geverifieerd.

## API

| Endpoint | Doel |
|---|---|
| `GET /health` | Liveness (geen auth). |
| `POST /v1/chat` | **SSE-stream**: body `{question, conversation_id?}` → events `status` · `token` · `sources` · `grounding` · `done` · `error`. |
| `POST /v1/chat-webhook` | **Niet-streamend** contract voor een chat-UI: body `{chatInput, sessionId, secret?}` (of header `X-Chat-Secret`) → `{"output": "<antwoord + bronnenlijst>"}`. In dit project belt de webapp-chatbel dit endpoint via de API-chatproxy. |

Authenticatie is optioneel (`QA_API_TOKEN` / `X-Chat-Secret`, timing-safe vergeleken); bij een
intern-only deployment staat het slot doorgaans uit. Verdere beveiliging: CORS met credentials
uitsluitend bij een expliciete origin-lijst, een per-IP rate-limit, en een read-only-vangnet dat
SPARQL-updates weigert.

## Lokaal draaien

Vereist [`uv`](https://docs.astral.sh/uv/). Zet minimaal `GRAPHDB_TOKEN` en de Azure-Foundry-variabelen
(zie `.env.example`). **Zonder `GRAPHDB_TOKEN` weigert de dienst te starten** — er mag geen tokenloos
verkeer naar de graaf lopen.

```bash
cd tools/graph-qa
cp .env.example .env          # vul GRAPHDB_TOKEN + AZURE_FOUNDRY_* in
uv run graph-qa               # uvicorn op poort 8080

uv run --extra dev pytest -q                    # tests
.venv/bin/python eval/run_eval.py --offline     # eval-harnas (fakes, geen netwerk/kosten)
```

## Configuratie (env)

| Variabele | Betekenis |
|---|---|
| `GRAPHDB_TOKEN` *(verplicht)* | Bearer-token voor de GraphDB-MCP. Ook als `GRAPHDB_TOKEN_FILE` (bestandspad, voor container-secrets). |
| `GRAPHDB_MCP_URL` | MCP-endpoint van de graaf. |
| `GRAPHDB_REPOSITORY_ID` | Repository (default `inning`). |
| `SIMILARITY_INDEX` | Naam van de GraphDB-similarity-index voor `semantic_search`. Leeg → die tool degradeert naar `search_wetgeving`. Zie `docs/embeddings-runbook.md`. |
| `AZURE_FOUNDRY_API_KEY` *(verplicht)* | Azure-AI-Foundry-key (of `_FILE`). |
| `AZURE_FOUNDRY_BASE_URL` *(verplicht)* | Foundry-endpoint **met** `/anthropic`-suffix. |
| `LLM_MODEL` | Modelnaam (default `claude-sonnet-4-6`). |
| `QA_API_TOKEN` | API-/chat-secret (of `_FILE`); leeg = open. |
| `CORS_ORIGINS` | Kommagescheiden origins; `*` = open (alleen dev). |
| `CHECKPOINT_DB_PATH` | Pad voor de durable checkpointer; leeg = in-memory (geen continuïteit over herstarts). |
| `MAX_TURNS` | Max. reason↔retrieve-beurten per vraag. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP-endpoint; leeg = alleen gestructureerde JSON-logs (nul overhead). |

## De graaf

De dienst leest **read-only** uit een GraphDB-repository (`inning`) via een MCP-server (Streamable
HTTP transport; tools `sparql_query` en `similarity_search`). De data betreft invorderings- en
belastingregelingen: regelingen, artikelen, leden, kruisverwijzingen, een SKOS-begrippenthesaurus en
organisatie-/geldigheidsmetadata, met stabiele BWB-IRI's en jci-vindplaatsen.

## Verder lezen

- **`CLAUDE.md`** — werkgids bij het aanpassen van de code (architectuur, invarianten, valkuilen).
- `deploy/README.md` — containerimage, secrets als bestanden, Portainer-stack en CI.
- `docs/embeddings-runbook.md` — de GraphDB-similarity-index achter `semantic_search`.
