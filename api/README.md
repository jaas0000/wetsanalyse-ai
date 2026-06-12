# wetsanalyse-api

Headless HTTP-backend die de wetsanalyse (JAS) als zelfstandige dienst aanbiedt. Dezelfde
inhoudelijke werkstroom als de Claude Code-skill — wettekst ophalen via de wettenbank-MCP,
activiteit 2 (markeren & classificeren) en activiteit 3 (begrippen & afleidingsregels) — maar
aangestuurd via een REST-API in plaats van via Claude Code.

Geschikt voor geautomatiseerde verwerking, integratie met andere systemen of als backend voor
een webapp of Teams-client.

## Hoe het past in het project

| Onderdeel | Rol |
|-----------|-----|
| **wettenbank-MCP** | Databron — haalt actuele wettekst op; wordt intern aangeroepen door de API |
| **wetsanalyse-skill** | Inhoudelijke referentie — de API hergebruikt exact dezelfde `references/` en `scripts/` |
| **wetsanalyse-api** *(deze map)* | HTTP-harness — biedt de werkstroom aan als async REST-API |
| **MongoDB** | Jobstore — één document per analyse (state + embedded rondes/feedback/rapport) |

## Endpoints

Alle analyse-endpoints zijn client-gescopet (alleen je eigen analyses) en versioneerd onder `/v1`.

| Methode | Pad | Wat het doet |
|---------|-----|--------------|
| `POST` | `/v1/projects` | Start een nieuwe analyse (async, 202 + `Location`) |
| `GET` | `/v1/projects?limit=&offset=` | Lijst van je analyses (gepagineerd) |
| `GET` | `/v1/projects/{id}` | Status en voortgang van een job |
| `DELETE` | `/v1/projects/{id}` | Verwijder (alleen in terminal state) |
| `POST` | `/v1/projects/{id}/feedback` | Geef reviewfeedback (alleen in `wacht-op-review-*`) |
| `POST` | `/v1/projects/{id}/retry` | Herstart een job in `fout`-state |
| `GET` | `/v1/projects/{id}/rapport` | Volledig rapport als JSON |
| `GET` | `/v1/projects/{id}/rapport.md` | Rapport als Markdown |
| `GET` | `/v1/projects/{id}/ronde/{act}/{n}` | Analyse-JSON van één ronde |
| `GET` | `/v1/projects/{id}/events` | SSE state-updates (max 10 min) |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check (auth, LLM, MCP geconfigureerd) |

Swagger-UI beschikbaar op `/docs`.

## Analyseverzoek

```json
POST /v1/projects
{
  "bwbId": "BWBR0004770",
  "artikel": "9",
  "lid": "2",
  "review": false
}
```

`bwbId` of `wet` (zoekterm) verplicht; `lid` optioneel. `review: false` slaat de
human-in-the-loop checkpoints over — uitsluitend voor geautomatiseerde verwerking.
Gebruik `review: true` (default) voor een volwaardige analyse met reviewrondes.

Job-states: `queued` → `act2-runt` → `wacht-op-review-act2` → `act3-runt` →
`wacht-op-review-act3` → `klaar` (of `fout` bij elke stap).

## Snel starten (lokaal)

```powershell
# 1. Secrets aanmaken in api\secrets\ (gitignored)
mkdir api\secrets
[IO.File]::WriteAllText("$PWD\api\secrets\llm_api_key",     "<azure-ai-foundry-key>")
[IO.File]::WriteAllText("$PWD\api\secrets\wettenbank_token", "<wettenbank-token>")
[IO.File]::WriteAllText("$PWD\api\secrets\api_tokens",       "lokaal:<token>")

# 2. .env aanmaken (kopieer .env.example en vul in)

# 3. Server starten (--env-file is verplicht)
cd api
uv sync --extra llm --extra dev
uv run --env-file .env uvicorn app.main:app --reload --port 3000
```

Zie `CLAUDE.md` voor de volledige opstapinstructies, Azure AI Foundry-config en
productie-deployment via Docker/Portainer.

## Authenticatie

Elke request vereist een bearer-token: `Authorization: Bearer <token>`.
Tokens worden geconfigureerd via `WETSANALYSE_API_TOKENS_FILE` in het formaat `id:token,...`.
Zet `WETSANALYSE_AUTH_REQUIRED=0` om auth lokaal uit te zetten.
