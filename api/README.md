# wetsanalyse-api

Headless HTTP-backend die de wetsanalyse (JAS) als REST-API aanbiedt — de kern van het agent-platform,
onder de webapp (analyse-webapp + werkplek). De inhoudelijke werkstroom is **activiteit 2** (markeren &
classificeren in JAS-klassen) en deelt de `references/`/`scripts/` met de (legacy) Claude Code-skill als
gemeenschappelijke inhoudsbron. De act-2-generatie is **agentisch op GraphDB** (agent⇄tools op de
job-modelprofiel-LLM; de wettenbank-MCP-pijplijn blijft als rollback). Begrippen (activiteit 3) en
RegelSpraak zijn verwijderd en worden later op een agentische basis herbouwd.

Geschikt als backend voor de webapp, voor geautomatiseerde verwerking en voor integratie met andere
systemen.

## Hoe het past in het project

| Onderdeel | Rol |
|-----------|-----|
| **GraphDB-MCP** | Databron voor de agentische act-2-motor — leden-tekst (brongetrouw corpus), jci, verwijzingen |
| **wettenbank-MCP** | Databron voor de deterministische rollback-motor + de formulier-catalogus/structuur |
| **wetsanalyse-skill** | Inhoudelijke referentie — de API hergebruikt exact dezelfde `references/` en `scripts/` |
| **wetsanalyse-api** *(deze map)* | HTTP-harness — biedt de act-2-werkstroom aan als async REST-API |
| **PostgreSQL** | Jobstore — `projects`-rij per analyse (state + telemetrie + rapport) + aparte `rondes`-tabel |

## Endpoints

Alle analyse-endpoints zijn client-gescopet (alleen je eigen analyses) en versioneerd onder `/v1`.

| Methode | Pad | Wat het doet |
|---------|-----|--------------|
| `POST` | `/v1/projects` | Start een nieuwe analyse (async, 202 + `Location`) |
| `GET` | `/v1/projects?limit=&offset=` | Lijst van je analyses (gepagineerd) |
| `GET` | `/v1/projects/{id}` | Status en voortgang van een job (incl. fijnmazige `current_fase`) |
| `GET` | `/v1/projects/events` | Aggregate SSE-stream over **al** je analyses (diff-emit + `removed`) — voedt het dashboard |
| `DELETE` | `/v1/projects/{id}` | Verwijder (terminal, `wacht-op-review-*` of `queued`; runt → 409) |
| `POST` | `/v1/projects/{id}/feedback` | Geef reviewfeedback (alleen in `wacht-op-review-act2`; status `akkoord` of `wijzigingen` — `akkoord` zonder opmerkingen rondt de analyse act2-only af) |
| `POST` | `/v1/projects/{id}/retry` | Herstart een job in `fout`-state |
| `GET` | `/v1/projects/{id}/rapport` | Volledig rapport als JSON |
| `GET` | `/v1/projects/{id}/rapport.md` | Rapport als Markdown |
| `GET` | `/v1/projects/{id}/ronde/{act}/{n}` | Analyse-JSON van één ronde (`act` = `2`) |
| `GET` | `/v1/projects/{id}/events` | SSE state-updates (max 10 min; incl. live agent-`current_fase`) |
| `GET` | `/v1/profiles` | Keuzelijst modelprofielen (alleen naam + default; client-auth, geen geheimen) |
| `GET` | `/v1/wetten` | Keuzelijst wetten (BWB-id + naam; client-auth) voor de dropdown |
| `GET` | `/v1/wetten/{bwbId}/structuur` | Afgeplatte artikellijst van een wet (voedt de artikel-autocomplete in het formulier) |
| `GET` | `/v1/wetten/{bwbId}/artikelen/{artikel}` | Leden + opschrift + tekstsnippet van één artikel (voedt de lid-keuzelijst) |
| `POST` | `/v1/annotatie/documenten` | Annotatie-document aanmaken (werkplek) |
| `GET` `DELETE` | `/v1/annotatie/documenten/{slug}` | Document ophalen / verwijderen |
| `PUT` | `/v1/annotatie/documenten/{slug}/elementen` | Door de agent voorgestelde JAS-elementen opslaan |
| `POST` | `/v1/annotatie/documenten/{slug}/elementen/{id}/beslissing` | Human-decision (approve/edit/reject/comment) |
| `GET` | `/v1/annotatie/documenten/{slug}/audit` | Append-only auditlog van het document |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check (booleans: auth, LLM, MCP, database geconfigureerd) |

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
| `GET`/`PUT` | `/v1/admin/settings` | Runtime-instellingen (o.a. de `capture_llm_calls`-toggle) |
| `GET` | `/v1/admin/projects/{slug}/llm-calls` | Vastgelegde LLM-calls van één analyse (prompt + ruwe respons) |
| `GET` | `/v1/admin/users` | Lijst login-accounts (userid, e-mail, rol, 2FA-aan, actief) |
| `POST` | `/v1/admin/users` | Maak een account (`userid`+`email`+`role`; geeft eenmalig een tijdelijk wachtwoord) |
| `PATCH` | `/v1/admin/users/{userid}` | Wijzig rol/actief (laatste actieve beheerder beschermd) |
| `POST` | `/v1/admin/users/{userid}/reset-password` | Nieuw tijdelijk wachtwoord |
| `DELETE` | `/v1/admin/users/{userid}` | Verwijder account |

Login-endpoints (de webapp-BFF is de enige client; achter het **client-token**), onder `/v1/auth`:

| Methode | Pad | Wat het doet |
|---------|-----|--------------|
| `GET` | `/v1/auth/setup-status` | Is de users-tabel nog leeg? (dan staat de eenmalige registratie open) |
| `POST` | `/v1/auth/setup` | Maak de allereerste beheerder (`userid`+`email`+`password`; alleen bij lege tabel → anders 409) |
| `POST` | `/v1/auth/verify` | Valideer **userid** + wachtwoord (+ optionele TOTP) |
| `GET` | `/v1/auth/me` | Eigen account (rol + 2FA-status) — `X-User-Id`-header |
| `POST` | `/v1/auth/change-password` | Eigen wachtwoord wijzigen (huidig → nieuw) — `X-User-Id`-header |
| `POST` | `/v1/auth/2fa/{begin,activate,disable}` | Optionele TOTP-2FA, self-service — `X-User-Id`-header |

Swagger-UI beschikbaar op `/docs`.

## Model-profielen (welk LLM)

De LLM-configuratie leeft in **benoemde modelprofielen** in de database, niet in losse env-vars:
provider, model, endpoint, temperatuur en een versleutelde API-key. Beheer ze via de admin-endpoints
hierboven of het `/beheer`-scherm in de [frontend](../frontend). Een analyse kiest een profiel op naam
(`model_profile` in het verzoek; governance: geen vrije model-string), en de engine bouwt per analyse
de client uit dat profiel — wijzigingen werken dus zonder redeploy. De env-`LLM_*`-waarden seeden bij
de eerste start één default-profiel en blijven de fallback-key. Het feitelijk gebruikte model wordt per
ronde in de `provenance` van het job-document vastgelegd (audit).

## Analyseverzoek

Een analyse is een **werkgebied** (kennisdomein) met **één of meer bronnen** (elke bron =
`bwbId` + `artikel` + optioneel `lid`):

```json
POST /v1/projects
{
  "bronnen": [
    { "bwbId": "BWBR0018450", "artikel": "43", "lid": "2" },
    { "bwbId": "BWBR0018715", "artikel": "5.6" }
  ],
  "naam": "Inkomensafhankelijke bijdrage Zvw",
  "omschrijving": "Domeincontext bij dit werkgebied",
  "analysefocus": "Berekenen van de inkomensafhankelijke bijdrage Zvw",
  "review": false
}
```

`bronnen` bevat minstens één bron; `bwbId` is per bron verplicht in v1 (wet-only resolutie via
zoekterm staat op de roadmap), `lid` is optioneel. Eén bron is het triviale geval. `review: false`
slaat de human-in-the-loop checkpoints over — uitsluitend voor geautomatiseerde verwerking. Gebruik
`review: true` (default) voor een volwaardige analyse met reviewrondes. **Scope: alleen activiteit 2**
(markeren + classificeren in JAS-klassen); begrippen (activiteit 3) en RegelSpraak zijn verwijderd en
worden later op een agentische basis herbouwd. Activiteit 2 wordt per bron uitgevoerd
(markeringen/verwijzingen, geaggregeerd in `bronnen[]`).

**Act-2-motor.** Standaard **agentisch** (`WETSANALYSE_ACT2_ENGINE=agent`): een agent⇄tools-loop op
de job-modelprofiel-LLM met **GraphDB** als bron — de agent haalt de bepaling (leden-tekst =
brongetrouw corpus) uit de graaf, volgt betekenisbepalende verwijzingen via een graaf-tool (diepte 1,
cap `WETSANALYSE_MAX_VERWIJZING_FETCHES`, default 6) en levert markeringen + verwijzingen in. Bij
`POST /v1/projects` doet de agent-motor een **dekkings-preflight**: staat een bron niet in de graaf,
dan faalt de create helder (`400`). De rollback-motor `deterministic` gebruikt de wettenbank-MCP
(twee-fase: verwijzing-inventaris → begrensde fetch-lus → brongetrouwe act-2). **Beide delen dezelfde
harde gate** (brongetrouwheid + JAS-schema → `fout`, ook `review:false`), review-lus, ronde-
immutabiliteit en rapportvorm. Het rapport draagt een `verwijzingen`-array náást de markeringen.

Grenzen: per-client rate limit en een max aantal gelijktijdige analyses (beide → `429`), een
optioneel LLM-token-budget per analyse, en een globale rem op gelijktijdige LLM-calls
(`WETSANALYSE_LLM_MAX_CONCURRENCY`) tegen provider-rate-limits — een 429 wordt geretryed met respect
voor de `Retry-After`-header. Per-call wandklok-timeout via `WETSANALYSE_LLM_TIMEOUT_S` (default 300;
een hele ronde kan bij een traag model >2 min duren). `WETSANALYSE_LLM_MAX_PROMPT_TOKENS` capt de
prompt (0 = auto uit het model) → duidelijke `PromptTooLargeError` i.p.v. een rauwe 400. Zie
`CLAUDE.md` §Misbruik-/kostenbeheersing.

Job-states: `queued` → `act2-runt` → `wacht-op-review-act2` → `bouwt` → `klaar` (of `fout` bij elke
stap). Bij het act-2-checkpoint rondt feedback-status `akkoord` zonder opmerkingen de analyse af naar
`klaar` met `scope: "act2"`. Binnen een `*-runt`/`bouwt`-state geeft een **observerend**
`current_fase`-veld de fijnmazige functiestap (bv. `agent-markeren`, `verwijzingen-volgen`,
`brongetrouwheid-check`) — los van de state-machine, puur voor live voortgang.

## Snel starten (lokaal)

```powershell
# 1. Secrets aanmaken in api\secrets\ (gitignored)
mkdir api\secrets
[IO.File]::WriteAllText("$PWD\api\secrets\llm_api_key",     "<azure-ai-foundry-key>")
[IO.File]::WriteAllText("$PWD\api\secrets\wettenbank_token", "<wettenbank-token>")
[IO.File]::WriteAllText("$PWD\api\secrets\graphdb_token",    "<graphdb-token>")   # agentische act-2-motor
[IO.File]::WriteAllText("$PWD\api\secrets\api_tokens",       "lokaal:<token>")
# Voor het LLM-beheer (/v1/admin/*) — optioneel lokaal:
[IO.File]::WriteAllText("$PWD\api\secrets\admin_tokens",      "admin:<admin-token>")
# Fernet-master-key (versleutelt API-keys uit de admin-UI); genereer met:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
[IO.File]::WriteAllText("$PWD\api\secrets\llm_config_secret", "<fernet-key>")

# 2. .env aanmaken (kopieer .env.example en vul in)

# 3. PostgreSQL draaien (de jobstore)
docker run -d -p 5432:5432 --name wetsanalyse-postgres-lokaal \
  -e POSTGRES_USER=wetsanalyse -e POSTGRES_PASSWORD=wetsanalyse -e POSTGRES_DB=wetsanalyse postgres:16

# 4. Server starten (--env-file is verplicht)
cd api
uv sync --extra llm --extra dev
uv run --env-file .env uvicorn app.main:app --reload --port 3000
```

Zet `DATABASE_URL=postgresql+asyncpg://wetsanalyse:wetsanalyse@localhost:5432/wetsanalyse` in `.env`;
de tabellen worden bij de start aangemaakt.

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

## Observability

De API is **geïnstrumenteerd**: gestructureerde JSON-logging (request-id-middleware, secret-redactie)
plus OpenTelemetry (traces/metrics/logs), gated op **`OTEL_EXPORTER_OTLP_ENDPOINT`** — leeg = no-op,
alleen logs. De orchestrator wikkelt elke fase in een span met metrics (fase-duur, fase-fouten per
klasse, LLM-tokens). Eén trace-id verbindt frontend → API → MCP. Nooit tokens/secrets/prompt-inhoud
loggen. Zie `app/observability.py` en de projectbrede
[`docs/observability.md`](../docs/observability.md) (env-vars, logschema, en de optionele
Grafana-stack in `deploy/observability/`).
