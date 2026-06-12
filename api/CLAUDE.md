# CLAUDE.md — wetsanalyse-api

Headless API-backend die de Wetsanalyse (JAS) orchestreert. Maakt van de Claude Code-skill een
zelfstandige, Dockeriseerbare dienst die je via HTTP (Postman/Swagger) bevraagt. Lees ook de
projectroot-`CLAUDE.md` en `.claude/skills/wetsanalyse/SKILL.md` (de skill blijft de inhoudelijke
bron; deze service is een parallelle harness over dezelfde references/scripts).

## Dragend principe

De **orchestrator bezit de review-lus en de state**; het **LLM doet per stap één begrensde taak**
("geef JSON conform schema"). **Stap 1 (ophalen) is deterministisch via de MCP** — geen LLM-tool-
calling. De `analyses/<id>/werk/.../ronde-N/`-mappenstructuur ís de jobstore en blijft interoperabel
met de lokale skill (zelfde artefacten op disk).

## Architectuur (app/)

- `config.py` — env-config + projectpaden (PROJECT_ROOT = repo-root).
- `contracts.py` — Pydantic-modellen (1-op-1 met `references/review-checkpoints.md`) + `Job`/state machine.
- `auth.py` — per-client bearer-tokens (erft het MCP-patroon; fail-closed; constant-tijd).
- `store.py` — filesystem-jobstore: atomair schrijven, **analyse.json-immutabiliteit**, per-job lock.
- `wettenbank.py` — MCP-client; lege/fout-respons → `WettenbankError` (nooit doorgaan met lege context).
- `validation.py` — **zacht** (skill-`check_activiteit_2/3`, schema) vs **hard** (brongetrouwheid: citaat
  letterlijk in leden-tekst na normalisatie, `vindplaats`/`bronreferentie` verplicht).
- `llm/` — `LLMClient`-protocol + LiteLLM-implementatie (provider = config; output-strategie + parse).
- `engine/` — `prompts.py` (references verbatim + canonieke JAS-lijst uit validation), `steps.py`
  (LLM-stap + merge met brongetrouwe MCP-basis), `orchestrator.py` (state machine, auto-correctie,
  6-rondencap, startup-reconciliatie, retry).
- `routers/analyses.py` + `main.py` — endpoints, `/health` (liveness), `/ready`.

## Garanties (niet aan tornen)

- HARD brongetrouwheid faalt → job naar `fout`, **ook in `review:false`**. Nooit stil `klaar`.
- Auto-correctie is **geen ronde**: her-genereren binnen één ronde vóór het wegschrijven.
- `feedback.json` alleen via de API en alleen in een `wacht-op-review-*`-state (anders 409).
- Brongetrouwe velden (`leden`, `bronreferentie`, `versiedatum`, `pad`) komen **uit de MCP**, niet uit het LLM.

## Lokaal draaien

### 1. Secrets aanmaken (eenmalig)

Maak `api/secrets/` aan (gitignored) en vul de drie bestanden:

```powershell
# Vanuit de projectroot:
mkdir api\secrets
[IO.File]::WriteAllText("$PWD\api\secrets\llm_api_key",      "<azure-ai-foundry-key>")
[IO.File]::WriteAllText("$PWD\api\secrets\wettenbank_token",  "<wettenbank-token>")   # = WETTENBANK_TOKEN uit env
[IO.File]::WriteAllText("$PWD\api\secrets\api_tokens",        "lokaal:<zelfgekozen-token>")
```

Genereer een willekeurig token: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`

### 2. `.env` aanmaken

Kopieer `.env.example` naar `.env` en vul in. Minimale Azure AI Foundry-config:

```
LLM_PROVIDER=azure_ai
LLM_MODEL=claude-sonnet-4-6
LLM_API_BASE=https://<resource-naam>.services.ai.azure.com   # geen /models achteraan
LLM_API_KEY_FILE=secrets/llm_api_key
WETTENBANK_TOKEN_FILE=secrets/wettenbank_token
WETSANALYSE_API_TOKENS_FILE=secrets/api_tokens
```

### 3. Server starten

```bash
cd api
uv sync --extra llm --extra dev
uv run --env-file .env uvicorn app.main:app --reload --port 3000
```

`uv run` laadt `.env` **niet** automatisch — de `--env-file .env` vlag is verplicht.
Swagger: `http://localhost:3000/docs` · health: `http://localhost:3000/health` · ready: `http://localhost:3000/ready`

### 4. Testen

```bash
uv run pytest -q               # unit-tests (fakes; geen netwerk)
# Fase 0-spike tegen echte MCP + Azure:
uv run --env-file .env --extra llm python scripts/spike_fase0.py BWBR0004770 9 1
```

**Geen vrije model-string vanuit de client**: kies een `model_profile`; het feitelijk gebruikte model
wordt per ronde in `job.json` vastgelegd (audit).

### Lokaal met Docker

Maak `api/docker-compose.override.yml` aan (gitignored) om de secrets-mount naar `./secrets` te
verwijzen in plaats van het productiepad `/opt/secrets/wetsanalyse-api`:

```yaml
services:
  wetsanalyse-api:
    volumes:
      - ./secrets:/run/secrets:ro
      - wetsanalyse_analyses:/app/analyses
```

Daarna: `docker compose up --build` vanuit `api/`.

## Deployment

Docker-image + Portainer-stack achter NPM, net als de MCP (`docker-compose.yml`). **Exact één
uvicorn-worker én één replica**: state-transities worden geserialiseerd met een in-process per-job
asyncio-lock. De jobstore is MongoDB (gedeeld), maar die lock werkt niet over processen/containers
heen — zet dus geen `--workers >1` of `deploy.replicas >1`. Schalen kan pas met een gedeelde lock
(Mongo state-CAS) of een echte job-queue (roadmap). LLM-key + tokens als bestanden op de host
(`*_FILE`-patroon) — nooit als plain env var in de container of Portainer-UI.
Build vanaf de **projectroot**: `docker build -f api/Dockerfile -t wetsanalyse-api .` (de image heeft de
skill-`references/scripts` nodig). `POST /analyses` is async (202 + polling) — nooit synchroon achter
NPM's ~60s timeout.

### Secrets op de host (eenmalig, vóór de eerste stack-start)

Het pad is configureerbaar via `SECRETS_DIR` in de stack-omgeving (default `/opt/secrets/wetsanalyse-api`).
Op een Synology NAS gebruik je `/volume1/docker/secrets/wetsanalyse-api`.

```bash
# Pas het pad aan naar jouw host (Synology: /volume1/docker/secrets/wetsanalyse-api)
SECRETS_DIR=/opt/secrets/wetsanalyse-api

sudo mkdir -p "$SECRETS_DIR"
sudo chmod 700 "$SECRETS_DIR"
echo -n "<llm-api-key>"      | sudo tee "$SECRETS_DIR/llm_api_key"      > /dev/null
echo -n "<wettenbank-token>" | sudo tee "$SECRETS_DIR/wettenbank_token"  > /dev/null
echo -n "id1:tok1,id2:tok2"  | sudo tee "$SECRETS_DIR/api_tokens"        > /dev/null
sudo chmod 600 "$SECRETS_DIR"/*
```

Rotatie: pas het betreffende bestand aan en herstart (`docker restart wetsanalyse-api`).
CI stuurt geen geheime waarden naar Portainer — alleen niet-geheime config (`LLM_MODEL`, `LLM_PROVIDER`, e.d.).

## Roadmap (nog niet gebouwd)

SSE `/events`; webapp + MS Teams-clients; wet-only resolutie (nu is `bwbId` verplicht); echte job-queue;
per-analyse-autorisatie/OIDC; rate-limiting + budgetcap.
