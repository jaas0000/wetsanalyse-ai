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

## Commando's

```bash
cd api
uv sync --extra dev            # test/dev-deps
uv run pytest -q               # testsuite (fakes voor LLM + MCP; geen netwerk)
uv run uvicorn app.main:app --reload --port 3000   # lokaal; Swagger op /docs
# Fase 0-spike tegen de echte MCP + Azure (vereist env + de llm-extra):
uv run --extra llm python scripts/spike_fase0.py BWBR0004770 9 1
```

Config via env — zie `.env.example`. **Geen vrije model-string vanuit de client**: kies een
`model_profile`; het feitelijk gebruikte model wordt per ronde in `job.json` vastgelegd (audit).

## Deployment

Docker-image + Portainer-stack achter NPM, net als de MCP (`docker-compose.yml`). Single uvicorn-worker
(concurrency leunt op per-job locks + filesystem-state). LLM-key + tokens als bestanden op de host
(`*_FILE`-patroon) — nooit als plain env var in de container of Portainer-UI.
Build vanaf de **projectroot**: `docker build -f api/Dockerfile -t wetsanalyse-api .` (de image heeft de
skill-`references/scripts` nodig). `POST /analyses` is async (202 + polling) — nooit synchroon achter
NPM's ~60s timeout.

### Secrets op de host (eenmalig, vóór de eerste stack-start)

```bash
sudo mkdir -p /opt/secrets/wetsanalyse-api
sudo chmod 700 /opt/secrets/wetsanalyse-api
echo -n "<llm-api-key>"      | sudo tee /opt/secrets/wetsanalyse-api/llm_api_key      > /dev/null
echo -n "<wettenbank-token>" | sudo tee /opt/secrets/wetsanalyse-api/wettenbank_token > /dev/null
echo -n "id1:tok1,id2:tok2"  | sudo tee /opt/secrets/wetsanalyse-api/api_tokens       > /dev/null
sudo chmod 600 /opt/secrets/wetsanalyse-api/*
```

Rotatie: pas het betreffende bestand aan en herstart (`docker restart wetsanalyse-api`).
CI stuurt geen geheime waarden naar Portainer — alleen niet-geheime config (`LLM_MODEL`, `LLM_PROVIDER`, e.d.).

## Roadmap (nog niet gebouwd)

SSE `/events`; webapp + MS Teams-clients; wet-only resolutie (nu is `bwbId` verplicht); echte job-queue;
per-analyse-autorisatie/OIDC; rate-limiting + budgetcap.
