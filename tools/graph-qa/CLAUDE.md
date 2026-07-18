# CLAUDE.md — graph-qa

Werkgids bij het aanpassen van de **graph-qa**-agent. Voor het *wat* en *hoe start ik het* zie
`README.md`; dit bestand is het *hoe werk ik erin* (architectuur, invarianten, valkuilen).

> **Write-guard let op:** de repo-hook `scripts/write_guard.py` is **cwd-relatief**. Blijf met je
> shell op de **projectroot** (`wetsanalyse-ai/`) of gebruik absolute paden; een `cd tools/graph-qa`
> laat elke volgende Write/Edit falen met "can't open file …/graph-qa/.claude/…/write_guard.py".

## Wat dit is

Een eigen juridische QA-agent over de BWB-kennisgraaf (GraphDB via MCP), als FastAPI/SSE-dienst.
Vervangt de vroegere n8n-chatbot; de webapp-chatbel loopt via `api/app/routers/chat.py` →
`POST /v1/chat-webhook`. Gebouwd in 3 fasen: fundament → grounding/retrieval/orkestrator/geheugen/
semantic → multi-agent. De volledige fase-voor-fase-log staat in het projectgeheugen
(`graph-qa-eigen-agent.md`), niet in een los ontwerpdoc.

## Architectuur (poorten & adapters + LangGraph)

De code leeft in **`agent/`** (domein) en **`api/`** (HTTP-laag) — er is bewust **geen** `graph_qa/`-map
(daarom noemt `pyproject.toml` de wheel-packages expliciet).

- **`agent/config.py`** — `Settings` (gewone pydantic `BaseModel` + `from_env()`, bewust **geen**
  pydantic-settings). `_read_secret()` leest eerst `<NAAM>_FILE` (Docker-secret-bestand), anders
  `<NAAM>`. `require_graph()` / `require_llm()` bewaken de verplichte secrets.
- **`agent/ports.py`** — `GraphPort` / `LLMPort` protocols. Alle afhankelijkheden gaan via deze
  poorten (DI), zodat tests fakes injecteren i.p.v. netwerk te raken.
- **`agent/adapters/`** — `anthropic_llm.py` (Anthropic Messages API via Azure Foundry
  `…/anthropic`, mét `stream()`), `graphdb_graph.py` (`make_graph()` → `MCPClient`; roept
  `require_graph()`).
- **`agent/mcp_client.py`** — MCP-client: `sparql()` via tool `sparql_query`, `semantic_search()` via
  `similarity_search`. Bevat een **read-only guard** die SPARQL-updates weigert.
- **`agent/tools/__init__.py`** — de **getypeerde toollaag**: `TOOLS` (12 stuks),
  `anthropic_schemas(only=…)` (subset per specialist) en `dispatch(name, graph, args, settings)`.
  Het model krijgt géén vrije SPARQL; `raw_sparql` is de afgeschermde uitzondering.
- **`agent/graph/`** — `queries.py` (SPARQL-bouwers, o.a. `context()` = de GraphRAG-UNION) en
  `schema.py` (schema-introspectie met cache).
- **`agent/orchestrator.py`** — het hart: een LangGraph `StateGraph`
  **router → agent ↔ tools → verify → (correct) → finalize**. `State` houdt `messages` en
  `entities_seen` als `operator.add`-reducers. Streaming loopt via `get_stream_writer()` (custom
  stream), niet via een langchain-chatmodel.
- **`agent/specialists.py`** — registry `{definitie, duiding, algemeen}`: systeem-addendum +
  tool-subset per specialist. Uitbreiden = één config-entry.
- **`agent/grounding.py`** — verifieert de citaties in het antwoord tegen de tool-trace op
  BWB-granulariteit; levert `grounded`/`unsupported`.
- **`agent/provenance.py`** — bronnen worden opgebouwd **uit de tool-trace**, niet uit modeltekst.
- **`agent/agent.py`** — `answer_stream()`: dunne wrapper die providers bouwt/injecteert, de
  checkpointer kiest en de graaf compileert en streamt. Publiek SSE-event-contract.
- **`api/main.py`** — FastAPI: `GET /health`, `POST /v1/chat` (SSE), `POST /v1/chat-webhook`
  (niet-streamend `{output}`). De **lifespan** doet fail-fast `require_graph()` bij boot.
- **`eval/`** — `golden.jsonl` + `run_eval.py` (`--offline` met fakes, of live).

## Kern-invarianten (niet breken)

- **Brongetrouwheid.** Bronnen en grounding komen uit de **tool-trace**, nooit uit een regex over
  modeltekst. Verzin geen citaten; als het niet uit een tool kwam, is het niet gegrond.
- **`GRAPHDB_TOKEN` is verplicht.** Afgedwongen bij startup (lifespan) én per request
  (`make_graph → require_graph`). Er mag **nooit tokenloos verkeer** naar de graaf lopen — de
  GraphDB-REST staat open+writable, dus de token is de enige poort. Maak dit niet optioneel.
- **Geen vrije SPARQL voor het model.** Voeg functionaliteit toe als een **getypeerde tool** in
  `agent/tools/` met een SPARQL-bouwer in `agent/graph/queries.py`. `raw_sparql` blijft de
  afgeschermde ontsnapping.
- **DI, geen globale clients.** Nieuwe afhankelijkheden achter een poort (`ports.py`) + adapter, zodat
  ze in tests te faken zijn.
- **Streaming-contract.** De event-types (`status`/`token`/`sources`/`grounding`/`done`/`error`)
  zijn het contract met de API/frontend. Wijzig ze bewust en gelijktijdig met de consumenten.

## Tests

```bash
# vanaf de projectroot (write-guard!), commando's draaien in tools/graph-qa
cd tools/graph-qa && uv run --extra dev pytest -q          # volledige suite
cd tools/graph-qa && uv run --extra dev pytest tests/test_orchestrator.py -q
cd tools/graph-qa && .venv/bin/python eval/run_eval.py --offline
```

- **`tests/fakes.py`** levert `FakeLLM` / `FakeGraph` / `make_settings`. `FakeLLM` speelt een vaste
  reeks Anthropic-responses af via `create()` én `stream()` (gedeelde index). Bouw multi-turn
  scenario's met `response([text_block(...), tool_block(...)], stop_reason)`.
- **Lifespan in tests:** de meeste tests gebruiken een **bare** `TestClient(main.app)` — die triggert
  de lifespan **niet**, dus de startup-tokencheck stoort ze niet. Wil je de startup zelf testen,
  gebruik dan `with TestClient(main.app):` (dat draait de lifespan) — zie `test_chat_webhook.py`.
- Zet `checkpoint_db_path=None` (default in `make_settings`) om een db-file te vermijden.

## Deployment & integratie

- **CI:** `.github/workflows/graph-qa-docker-publish.yml` (test → build → GHCR → Portainer-redeploy).
  De deploy-stap is gated op repo-var `PORTAINER_GRAPH_QA_STACK_ID` (=242) en gebruikt
  `AZURE_FOUNDRY_BASE_URL` (repo-var, mét `/anthropic`) — die is verplicht, anders faalt de
  compose-guard `:?`.
- **Stack:** intern-only (geen host-poort), image `ghcr.io/palmw01/graph-qa`. Secrets zijn
  host-bestanden (`/volume1/docker/secrets/graph-qa/{graphdb_token,azure_foundry_api_key}`) die via
  `*_FILE`-env worden ingelezen; volume `/data` houdt de checkpointer-db durabel. Details:
  `deploy/README.md`.
- **Webapp:** de API-chatproxy stuurt `{action,sessionId,chatInput}` + `X-Chat-Secret` en verwacht
  `{output}`; `sessionId` wordt `conversation_id` (geheugen-continuïteit).

## Bekende aandachtspunten

- `semantic_search` vereist een bestaande GraphDB-similarity-index (`SIMILARITY_INDEX=bwb_similarity`
  in de deployment-env); ontbreekt die, dan degradeert de tool naar `search_wetgeving`. Aanmaak/
  achtergrond: `docs/embeddings-runbook.md`.
- De GraphDB-REST (`graphdb.ipalm.nl`) staat nog **open + writable** zonder auth — de read-only guard
  in `mcp_client.py` is dus een tweede net, geen slot. Openstaand security-punt (achter auth zetten).
