# CLAUDE.md — graph-qa

Werkgids bij het aanpassen van deze agent. Het *wat* en *hoe start ik het* staat in `README.md`; dit
bestand beschrijft *hoe de code in elkaar zit* en welke eigenschappen je niet mag breken.

> **Write-guard:** de repo-hook `.claude/skills/wetsanalyse/scripts/write_guard.py` wordt
> **relatief aan je shell-cwd**
> aangeroepen. Blijf met je shell op de **projectroot** (`wetsanalyse-ai/`) of gebruik absolute paden;
> na een `cd tools/graph-qa` faalt elke Write/Edit met "can't open file …/graph-qa/.claude/…".

## In één zin

Een retrieval-augmented QA-dienst die vragen over de invorderings-/belastingwetgeving in een
GraphDB-kennisgraaf beantwoordt — het antwoord komt **uitsluitend** uit de graaf (via een getypeerde
toollaag), en wordt achteraf op brongetrouwheid gecontroleerd.

## Twee lagen: `agent/` (domein) en `api/` (HTTP)

De code leeft in `agent/` en `api/`; er is bewust **geen** `graph_qa/`-package (`pyproject.toml`
benoemt daarom expliciet welke packages in de wheel horen — anders faalt `uv sync`).

### De uitvoeringsketen (`agent/orchestrator.py`)

Het hart is een LangGraph `StateGraph`:

```
router → agent ⇄ tools → verify → (correct) → finalize
```

- **`router_node`** — één LLM-call (`llm.create`, geen tools) die exact twee regels teruggeeft:
  `SPECIALIST:` (definitie|duiding|algemeen) en `PLAN:` (of `AFWIJZEN` bij een off-topic vraag). De
  eerder geraadpleegde bepalingen worden als context meegegeven.
- **`agent_node`** — draait de gekozen specialist: `SYSTEM_PROMPT` + het specialist-addendum + het plan,
  met `anthropic_schemas(only=spec.tools)` als toolset. Streamt tekst-deltas via `get_stream_writer()`.
  *Let op:* op een beurt-grens (turns > 0) wordt vóór de eerste tekst-delta één `\n\n` geëmit, zodat de
  narratie van opeenvolgende beurten niet aan elkaar plakt.
- **`tools_node`** — voert elke tool-aanroep uit via `dispatch(name, graph, args, settings)` en voegt
  `(tool_naam, resultaat)` toe aan de `source_trace`.
- **`verify_node`** — `check_grounding(answer, source_trace)`; bij ongegrond én `grounding_correct`
  volgt via `correct_node` één corrigerende her-vraag.
- **`finalize_node`** — `collect_sources` (uit de trace) → `curate_sources` (beperken tot aangehaalde
  regelingen) → emit `sources` + `grounding`; werkt `entities_seen` bij (nieuwe IRI's, dedup).

Met `enable_decomposition` (env `ENABLE_DECOMPOSITION`, default uit) vertakt `build_graph` naar een
multi-hop-graaf **router → decompose → solve → synthesize → verify → (resynth) → finalize**:
`decompose_node` splitst in deelvragen, `solve_node` draait de agent⇄tools-loop **per deelvraag** met
lokale scratch-messages (deelvraag-tokens streamen niet; alleen de synthese) en accumuleert de gedeelde
`source_trace`, en `synthesize_node` streamt het eind-antwoord uit de bevindingen. Grounding/provenance
draaien ongewijzigd op dat eind-antwoord. Staat de toggle uit, dan is de één-loop-stroom byte-voor-byte
ongewijzigd (aparte edges/nodes; `agent_node`/`tools_node`/`correct_node` worden dan niet gebruikt door
de decompositie-tak).

`State` (een `TypedDict`) houdt o.a. `messages` en `entities_seen` als `operator.add`-reducers
(append), plus de werkvelden (`source_trace`, `answer`, `grounded`, …). `agent/agent.py`
(`answer_stream`) is de dunne wrapper: hij bouwt/injecteert de providers, kiest de checkpointer,
compileert de graaf en levert het SSE-event-contract.

### Gespreksgeheugen (checkpointer)

`thread_id = conversation_id`; de agent krijgt per beurt de **volledige gepersisteerde `messages`-historie**
mee (getrimd op `max_history_chars`), inclusief zijn eigen antwoorden — én de annotatie-worker laat een
korte assistant-samenvatting van de markeringen achter, zodat vervolgvragen context hebben. Backend-keuze
(`_checkpointer_ctx`, voorrang): **`CHECKPOINT_DB_URL`** → `AsyncPostgresSaver` (gedeeld → **horizontaal
veilig**, verplicht bij >1 replica) → **`CHECKPOINT_DB_PATH`** → `AsyncSqliteSaver` (durable file, maar
**per-instance**) → in-memory. `DELETE /v1/conversations/{id}` wist de thread (`adelete_thread`).

> **Twee gescheiden stores op dezelfde `conversation_id`.** De UI-historie leeft in de **API**
> (`/v1/gesprekken/*`, Postgres); het agent-geheugen in **deze checkpointer**. Ze zijn onafhankelijk —
> een gesprek verwijderen wist bewust bóiden (BFF roept de API-delete én deze `DELETE /v1/conversations/{id}`
> aan). Bij een reset van één store (bv. het checkpointer-volume) kan de UI historie tonen die de agent
> niet meer heeft; dat is een geaccepteerde consequentie van de gescheiden opslag.

### Poorten & adapters (DI)

- **`ports.py`** — `GraphPort` / `LLMPort` protocols. Alles wat naar buiten praat, loopt hierlangs,
  zodat tests fakes injecteren i.p.v. netwerk te raken.
- **`adapters/anthropic_llm.py`** — Anthropic Messages API via Azure AI Foundry (`…/anthropic`), met
  `create()` en `stream()`. Bewust géén langchain-chatmodel.
- **`adapters/graphdb_graph.py`** — `make_graph(settings)` → `MCPClient`; roept `settings.require_graph()`.
- **`mcp_client.py`** — synchrone MCP-client (Streamable HTTP): `sparql()` via tool `sparql_query`,
  `semantic_search()` via `similarity_search`. Eén persistente `httpx.Client`. `_reject_updates`
  weigert SPARQL die op een update lijkt (read-only vangnet).

### Toollaag & queries

- **`tools/__init__.py`** — `TOOLS` (13 declaraties met JSON-schema + handler), `anthropic_schemas(only=)`
  (model-facing subset) en `dispatch()` (voert de handler uit; vangt `ValueError`/`MCPError`/`KeyError`
  als tekst i.p.v. te crashen). Een tool met `needs_settings` krijgt `settings` mee (bv. `semantic_search`).
- **`graph/queries.py`** — de SPARQL-bouwers (o.a. `context()` = de GraphRAG-UNION). **`graph/schema.py`** —
  schema-introspectie met cache.

### Brongetrouwheid (`provenance.py` + `grounding.py`)

- `provenance.iter_refs` herkent vindplaatsen — BWB-IRI's (`https://ipalm.nl/bwb/…`), jci-strings
  (`jci…:c:BWBR…`) en kale BWB-id's — in **tool-resultaten**. `collect_sources` bouwt daaruit de
  ontdubbelde bronnenlijst. Bronnen komen dus nooit uit de prozatekst van het model.
- `grounding.check_grounding` past diezelfde herkenning toe op het **antwoord** en markeert citaten
  waarvan het BWB-id niet in de trace voorkomt. Deterministisch, op BWB-granulariteit (geen vals alarm
  op jci-formattering of geparafraseerde IRI's). `curate_sources` snoeit de lijst tot aangehaalde
  regelingen.

### API-laag (`api/main.py`)

`GET /health`, `POST /v1/chat` (SSE; body `{question, conversation_id?}`), `DELETE /v1/conversations/{id}`
(wist het agent-geheugen — de checkpointer-thread — van één gesprek; idempotent → 204; de werkplek roept
dit aan bij het verwijderen van een gesprek, náást de API-berichten-delete) en `GET /v1/artikel`
(artikeltekst uit de graaf voor het documentpaneel van de werkplek; query `bwb_id`/`artikel`/`lid?`).
De **lifespan** doet fail-fast `settings.require_graph()` bij boot en flush't de OTel-buffers bij
shutdown (`observability.shutdown()`). Beveiliging: CORS-credentials nooit samen met `*` (elke `"*"`
in de origin-lijst telt als wildcard), per-IP rate-limit (dependency, geen middleware — anders buffert
de SSE), timing-safe token-check.

### De annotatie-keten

`ophaal (agent ⇄ tools) → annoteer → critic`. Drie dingen die je moet kennen voordat je hieraan werkt:

- **Elk voorstel draagt een `id`** dat `_verwerk` toekent (niet het model). De Critic koppelt zijn
  oordeel daarop; op positie koppelen brak zodra een ronde een element toevoegde of wegliet. Geeft
  het model een `id` mee, dan blijft dat behouden — zo matcht de api het bij een volgende ronde op
  hetzelfde element en blijven de beslissingen van de jurist staan.
- **Verworpen fragmenten gaan niet verloren.** `_verwerk` geeft ze terug met een reden
  (`niet_letterlijk` of `ongeldige_klasse`) in plaats van ze te tellen. Een bijna-goed citaat is met
  die aanwijzing prima te repareren — dat is de goedkoopste kwaliteitswinst in de keten.
- **De Critic geeft instructies, geen klachten.** Naast `aandacht` + `motivatie` levert hij
  `actie` (`behoud|vervang|verwijder`) met een `voorstel_klasse`/`voorstel_tekst`. `verwijder` mag
  alleen bij rood, en `vervang` zonder voorstel degradeert naar `behoud` — anders is het geen
  opdracht. Die normalisatie zit in `_verwerk_critic`, niet in de prompt: op een model vertrouwen
  voor een veiligheidsregel is geen veiligheidsregel.

## Kern-invarianten (niet breken)

- **Brongetrouwheid.** Bronnen én grounding komen uit de **tool-trace**, nooit uit een regex over
  modeltekst. Als iets niet uit een tool kwam, is het geen bron en niet gegrond.
- **`GRAPHDB_TOKEN` is verplicht.** Afgedwongen bij startup (lifespan) én per request (`make_graph →
  require_graph`). Het token is de sleutel voor de auth-proxy, die hem vervangt door het
  GraphDB-service-account; de agent kent die credentials zelf niet. Maak dit niet optioneel.
- **Geen vrije SPARQL voor het model.** Nieuwe retrieval = een **getypeerde tool** in `tools/` met een
  bouwer in `graph/queries.py`. `raw_sparql` blijft de afgeschermde ontsnapping.
- **DI, geen globale clients.** Afhankelijkheden achter een poort + adapter, zodat ze faken te zijn.
- **SSE-event-contract.** De event-types (`status`/`reason`/`token`/`sources`/`grounding`/`done`/`error`,
  plus `doel`/`element`/`ontbrekend` van de annotatie-worker — alles over `POST /v1/chat`) zijn het
  contract met de consumenten (de werkplek); wijzig ze
  bewust en gelijktijdig. **`reason` = het denkproces** (tool-narratie, live gestreamd); **`token` = alléén
  het eindantwoord** — hou die twee gescheiden zodat de werkplek ze los kan tonen. De annotatie-keten is
  `annoteer → critic → advance`: `annoteer_node` grondt de voorstellen (state), `critic_node` zet per
  element een **aandacht**-niveau (groen|geel|rood) + `critic`-motivatie, emit de `element`-events en één
  `ontbrekend`-event (waarschijnlijk ontbrekende JAS-klassen). De Critic mag de annotatie nooit breken.
- **Onderwerp-afbakening & injectie.** De agent antwoordt alleen over de wetgeving in de graaf en
  behandelt graaftekst als data. Verzwak `SYSTEM_PROMPT`/`_ROUTER_SYSTEM` hierin niet zonder reden.

## Tests & eval

```bash
# vanaf de projectroot (write-guard); commando's zelf draaien in tools/graph-qa
cd tools/graph-qa && uv run --extra dev pytest -q
cd tools/graph-qa && uv run --extra dev pytest tests/test_orchestrator.py -q
cd tools/graph-qa && .venv/bin/python eval/run_eval.py --offline
```

- **`tests/fakes.py`** levert `FakeLLM` / `FakeGraph` / `make_settings`. `FakeLLM` speelt een vaste
  reeks Anthropic-responses af via `create()` én `stream()` (gedeelde index). Bouw multi-turn-scenario's
  met `response([text_block(...), tool_block(...)], stop_reason)`.
- **Lifespan in tests:** de meeste tests gebruiken een **bare** `TestClient(main.app)` — die draait de
  lifespan **niet**, dus de startup-tokencheck stoort ze niet. Wil je de startup zelf testen, gebruik
  `with TestClient(main.app):` (de context-manager draait de lifespan wél).
- `make_settings` zet `checkpoint_db_path=None` (in-memory) om db-files te vermijden.

## Deployment & integratie

- **CI:** `.github/workflows/graph-qa-docker-publish.yml` (test → build → GHCR, met een Trivy-gate).
  De workflow publiceert alleen het image; uitrollen is een aparte stap. De compose-guard vereist
  `AZURE_FOUNDRY_BASE_URL` (repo-var, mét `/anthropic`) — dat is de LLM-provider, niet een deploydoel.
- **Secrets** zijn host-bestanden die via `*_FILE`-env worden ingelezen (`config._read_secret`); een
  named volume houdt de checkpointer-db durabel. Zie `deploy/README.md`.
- **Werkplek-integratie:** de werkplek (frontend `/workbench`) belt `POST /v1/chat` **rechtstreeks**
  via een SSE-BFF-route (`{question, conversation_id}`); `conversation_id` geeft geheugen-continuïteit.
  Het documentpaneel haalt artikeltekst op via `GET /v1/artikel`. De persistente review-state loopt
  niet hierlangs maar via de wetsanalyse-API (`/v1/annotatie/*`).

## Aandachtspunten

- `semantic_search` vereist een bestaande GraphDB-similarity-index (`SIMILARITY_INDEX`); ontbreekt die,
  dan degradeert de tool naar `search_wetgeving`. Achtergrond: `docs/embeddings-runbook.md`.
- GraphDB draait met security aan en de agent komt er alleen via de auth-proxy in. De read-only
  guard in `mcp_client.py` (`_reject_updates`) blijft een tweede net: het service-account mág
  schrijven op `inning`, dus de guard is wat een schrijf-SPARQL vanuit de agent tegenhoudt.
- **SSE-client-disconnect:** de LangGraph-nodes zijn synchroon en draaien in de default-executor; een
  `run_in_executor`-future is niet annuleerbaar. Valt de client midden in de stream weg, dan loopt een
  in-flight LLM-call (timeout 120s) of MCP-call in de achtergrondthread nog dóór tot hij klaar is —
  ook al is de generator al gecancelt en heeft `finally: graph.close()` de httpx-client gesloten.
  `MCPClient.close()` is daarom best-effort (idempotent, slikt fouten) zodat het sluiten niet stukloopt
  op een nog lopende call. Volledige annulering vergt async-nodes; bewust niet gedaan.
