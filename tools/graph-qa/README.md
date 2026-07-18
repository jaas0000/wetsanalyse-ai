# graph-qa — juridische vraagbeantwoording over de BWB-kennisgraaf

`graph-qa` is de **eigen juridische QA-agent** van dit project: een FastAPI-dienst die vragen over
Nederlandse wet- en regelgeving beantwoordt door een **GraphDB-kennisgraaf** (de BWB-graaf) te
bevragen via de **MCP**-toollaag, en het antwoord **brongetrouw** onderbouwt. Hij vervangt de eerdere
n8n-chatbot achter de webapp-chatbel: de API proxyt de chatbel naar dit endpoint
(`api/app/routers/chat.py` → `POST /v1/chat-webhook`).

De kern is dat het antwoord **niet** op modelgeheugen leunt maar op de graaf: elke bewering is
herleidbaar naar een opgehaalde bepaling (artikel/lid + BWB-id), en een **grounding**-controle
verifieert de citaten tegen wat de tools daadwerkelijk teruggaven.

## Wat het doet

- **Retrieval over de graaf** via een getypeerde toollaag (geen vrije SPARQL voor het model):
  `resolve_begrip`, `search_wetgeving`, `semantic_search`, `get_artikel`, `get_lid`, `get_context`
  (GraphRAG-subgraaf), `follow_verwijzingen`, `referenced_by`, `list_regelingen`, `get_regeling_info`,
  `graph_schema` en (afgeschermd) `raw_sparql`.
- **Multi-agent supervisor**: een router kiest per vraag één specialist — `definitie` (begrippen),
  `duiding` (betekenis/samenhang) of `algemeen` — elk met een eigen tool-subset en systeeminstructie.
- **Grounding + bron-curatie**: bronnen komen uit de tool-trace (niet uit modeltekst); niet-onderbouwde
  citaties worden gemarkeerd en de bronnenlijst wordt beperkt tot wat in het antwoord is aangehaald.
- **Geheugen** over de conversatie via een durable LangGraph-checkpointer (`thread_id` =
  `conversation_id`/`sessionId`).
- **Streaming** (SSE) met live status- en token-events.

De agent is gebouwd in drie fasen (uit een architectuurreview): **Fase 1** fundament (DI-poorten,
provenance uit de tool-trace, security, getypeerde tools), **Fase 2** grounding + eval + observability,
GraphRAG-retrieval, LangGraph-orkestrator, geheugen-tiers en semantic search, **Fase 3** het
multi-agent supervisor-patroon.

## API

| Endpoint | Doel |
|---|---|
| `GET /health` | Liveness (geen auth). |
| `POST /v1/chat` | **SSE-stream**: `{question}` → events `status`/`token`/`sources`/`grounding`/`done`/`error`. |
| `POST /v1/chat-webhook` | **Niet-streamend** compat-contract voor de webapp-chatbel: `{chatInput, sessionId, secret?}` + header `X-Chat-Secret` → `{"output": "<antwoord + bronnen>"}`. |

Auth is optioneel (`QA_API_TOKEN` / `X-Chat-Secret`, timing-safe); bij een intern-only deployment
staat het slot doorgaans uit.

## Snel starten (lokaal)

Vereist [`uv`](https://docs.astral.sh/uv/). Zet minimaal `GRAPHDB_TOKEN` en de Azure-Foundry-variabelen
(zie `.env.example`) — **zonder `GRAPHDB_TOKEN` weigert de service te starten**.

```bash
cd tools/graph-qa
cp .env.example .env          # vul GRAPHDB_TOKEN + AZURE_FOUNDRY_* in
uv run graph-qa               # start uvicorn op poort 8080 (POST /v1/chat)

# tests
uv run --extra dev pytest -q

# eval-harnas (offline = fakes, geen netwerk/kosten)
.venv/bin/python eval/run_eval.py --offline
```

## Configuratie (env)

| Variabele | Betekenis |
|---|---|
| `GRAPHDB_TOKEN` *(verplicht)* | Bearer-token voor de GraphDB-MCP. Kan als `GRAPHDB_TOKEN_FILE` (bestandspad, voor Docker-secrets). |
| `GRAPHDB_MCP_URL` | MCP-endpoint (default `https://graphdb-mcp.ipalm.nl/mcp`). |
| `GRAPHDB_REPOSITORY_ID` | Repository (default `inning`). |
| `SIMILARITY_INDEX` | GraphDB-similarity-index voor `semantic_search` (deployment: `bwb_similarity`). Leeg → degradeert naar `search_wetgeving`. |
| `AZURE_FOUNDRY_API_KEY` *(verplicht)* | Azure-AI-Foundry-key (of `_FILE`). |
| `AZURE_FOUNDRY_BASE_URL` *(verplicht)* | Foundry-endpoint **met** `/anthropic`-suffix. |
| `LLM_MODEL` | Modelnaam (default `claude-sonnet-4-6`). |
| `QA_API_TOKEN` | API-/chat-secret (of `_FILE`); leeg = open. |
| `CORS_ORIGINS` | Kommagescheiden origins; `*` = open (alleen dev). |
| `CHECKPOINT_DB_PATH` | Pad voor de durable checkpointer (deployment: `/data/...`); leeg = in-memory. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP-endpoint; leeg = alleen JSON-logs (nul overhead). |

## Deployment

Zie **`deploy/README.md`**. Kort: CI (`.github/workflows/graph-qa-docker-publish.yml`) bouwt het image
`ghcr.io/palmw01/graph-qa`, en een Portainer-stack draait het **intern-only** (geen host-poort; de API
bereikt het op `http://graph-qa:8080`). Secrets zijn host-bestanden die via `*_FILE`-env worden
ingelezen (`/run/secrets:ro`). De semantic-index staat beschreven in `docs/embeddings-runbook.md`.

## Verder lezen

- **`CLAUDE.md`** — werkgids bij het aanpassen van de code (architectuur, invarianten, valkuilen).
- `deploy/README.md` — Portainer-stack, secrets, CI.
- `docs/embeddings-runbook.md` — de GraphDB-similarity-index voor `semantic_search`.
