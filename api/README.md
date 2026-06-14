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
| `DELETE` | `/v1/projects/{id}` | Verwijder (terminal of `wacht-op-review-*`; lopend → 409) |
| `POST` | `/v1/projects/{id}/feedback` | Geef reviewfeedback (alleen in `wacht-op-review-*`) |
| `POST` | `/v1/projects/{id}/retry` | Herstart een job in `fout`-state |
| `GET` | `/v1/projects/{id}/rapport` | Volledig rapport als JSON |
| `GET` | `/v1/projects/{id}/rapport.md` | Rapport als Markdown |
| `GET` | `/v1/projects/{id}/ronde/{act}/{n}` | Analyse-JSON van één ronde |
| `GET` | `/v1/projects/{id}/events` | SSE state-updates (max 10 min) |
| `GET` | `/v1/profiles` | Keuzelijst modelprofielen (alleen naam + default; client-auth, geen geheimen) |
| `GET` | `/v1/wetten` | Keuzelijst wetten (BWB-id + naam; client-auth) voor de dropdown |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check (booleans: auth, LLM, MCP, MongoDB geconfigureerd) |

Admin-endpoints (LLM-beheer) achter een **apart admin-token**, onder `/v1/admin`:

| Methode | Pad | Wat het doet |
|---------|-----|--------------|
| `GET` | `/v1/admin/profiles` | Lijst modelprofielen (incl. verbruik; key nooit, alleen `api_key_set`) |
| `PUT` | `/v1/admin/profiles/{name}` | Maak/werk profiel bij (API-key write-only) |
| `DELETE` | `/v1/admin/profiles/{name}` | Verwijder (niet de default) |
| `POST` | `/v1/admin/profiles/{name}/default` | Markeer als default |
| `POST` | `/v1/admin/profiles/{name}/test` | Test de verbinding (kleine LLM-call) |
| `GET` | `/v1/admin/usage` | Token-verbruik (aggregatie over `provenance`; `group_by=model\|model_profile\|client_id`) |
| `GET` | `/v1/admin/wetten` | Lijst wet-catalogus (BWB-id + naam) |
| `PUT` | `/v1/admin/wetten/{bwbId}` | Maak/werk catalogus-item bij (BWB-id + naam) |
| `DELETE` | `/v1/admin/wetten/{bwbId}` | Verwijder catalogus-item |
| `POST` | `/v1/admin/wetten/{bwbId}/resolve` | Stel de officiële citeertitel voor via de MCP |

Swagger-UI beschikbaar op `/docs`.

## Model-profielen (welk LLM)

De LLM-configuratie leeft in **benoemde modelprofielen** in MongoDB, niet in losse env-vars:
provider, model, endpoint, temperatuur en een versleutelde API-key. Beheer ze via de admin-endpoints
hierboven of het `/beheer`-scherm in de [frontend](../frontend). Een analyse kiest een profiel op naam
(`model_profile` in het verzoek; governance: geen vrije model-string), en de engine bouwt per analyse
de client uit dat profiel — wijzigingen werken dus zonder redeploy. De env-`LLM_*`-waarden seeden bij
de eerste start één default-profiel en blijven de fallback-key. Het feitelijk gebruikte model wordt per
ronde in de `provenance` van het job-document vastgelegd (audit).

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

`bwbId` is verplicht in v1 (wet-only resolutie via zoekterm staat op de roadmap); `lid` optioneel.
`review: false` slaat de human-in-the-loop checkpoints over — uitsluitend voor geautomatiseerde
verwerking. Gebruik `review: true` (default) voor een volwaardige analyse met reviewrondes.

**Cross-referenties.** Activiteit 2 is twee-fase: eerst een lichte *verwijzing-inventaris* (per
verwijzing een functie + `volgen`-vlag), dan een begrensde deterministische fetch-lus die de
te-volgen verwezen artikelen via de MCP ophaalt (diepte 1, cap `WETSANALYSE_MAX_VERWIJZING_FETCHES`,
default 6; een gefaalde fetch degradeert stil en laat de job nooit falen), waarna het LLM de
`betekenis`/`status` brongetrouw invult met de opgehaalde tekst. Het rapport draagt een
`verwijzingen`-array; begrippen kunnen via `bron_verwijzing` op een definitie-verwijzing steunen.

Grenzen: per-client rate limit en een max aantal gelijktijdige analyses (beide → `429`), een
optioneel LLM-token-budget per analyse, en een globale rem op gelijktijdige LLM-calls
(`WETSANALYSE_LLM_MAX_CONCURRENCY`) tegen provider-rate-limits — een 429 wordt geretryed met respect
voor de `Retry-After`-header. Zie `CLAUDE.md` §Misbruik-/kostenbeheersing.

Job-states: `queued` → `act2-runt` → `wacht-op-review-act2` → `act3-runt` →
`wacht-op-review-act3` → `klaar` (of `fout` bij elke stap).

## Snel starten (lokaal)

```powershell
# 1. Secrets aanmaken in api\secrets\ (gitignored)
mkdir api\secrets
[IO.File]::WriteAllText("$PWD\api\secrets\llm_api_key",     "<azure-ai-foundry-key>")
[IO.File]::WriteAllText("$PWD\api\secrets\wettenbank_token", "<wettenbank-token>")
[IO.File]::WriteAllText("$PWD\api\secrets\api_tokens",       "lokaal:<token>")
# Voor het LLM-beheer (/v1/admin/*) — optioneel lokaal:
[IO.File]::WriteAllText("$PWD\api\secrets\admin_tokens",      "admin:<admin-token>")
# Fernet-master-key (versleutelt API-keys uit de admin-UI); genereer met:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
[IO.File]::WriteAllText("$PWD\api\secrets\llm_config_secret", "<fernet-key>")

# 2. .env aanmaken (kopieer .env.example en vul in)

# 3. MongoDB draaien (de jobstore) — lokaal zonder auth
docker run -d -p 27017:27017 --name wetsanalyse-mongo-lokaal mongo:4.4

# 4. Server starten (--env-file is verplicht)
cd api
uv sync --extra llm --extra dev
uv run --env-file .env uvicorn app.main:app --reload --port 3000
```

Lokaal staat `MONGODB_URL` op de default `mongodb://localhost:27017` (geen auth nodig).

Zie `CLAUDE.md` voor de volledige opstapinstructies, Azure AI Foundry-config en
productie-deployment via Docker/Portainer.

## Authenticatie

Elke request vereist een bearer-token: `Authorization: Bearer <token>`.
Tokens worden geconfigureerd via `WETSANALYSE_API_TOKENS_FILE` in het formaat `id:token,...`.
Zet `WETSANALYSE_AUTH_REQUIRED=0` om auth lokaal uit te zetten.

De **admin-endpoints** (`/v1/admin/*`) gebruiken een aparte tokenlijst `WETSANALYSE_ADMIN_TOKENS(_FILE)`
(zelfde `id:token,...`-vorm) en zijn **altijd** auth-plichtig — geen `AUTH_REQUIRED`-bypass; zonder
admin-tokens geeft alles 401. Het opslaan van een API-key via de admin-UI vereist daarnaast een
Fernet-master-key in `LLM_CONFIG_SECRET(_FILE)`; ontbreekt die, dan blijven profielen op de
env-`LLM_API_KEY` terugvallen en weigert de UI een key op te slaan.
