# CLAUDE.md — wetsanalyse-api

Headless API-backend voor de **Wetsanalyse-werkplek** — een kerncomponent van het agent-platform, een
zelfstandige, Dockeriseerbare dienst die je via HTTP (Postman/Swagger) bevraagt en die de
[frontend](../frontend) (de werkplek + login + `/beheer`) bedient. Lees ook de projectroot-`CLAUDE.md`.

## Scope: wat deze API nog doet

Na de pivot naar de chat-werkruimte bedient de API vijf dingen:

1. **Het JAS-annotatiedomein van de werkplek** (`/v1/annotatie/*`): documenten/elementen/beslissingen
   + append-only auditlog. De agent stelt voor, de mens beslist; de API bewaart de review-state.
   **Client-gescopet** (gedeeld tussen ingelogde gebruikers van dezelfde BFF-client).
2. **De chatgeschiedenis van de werkplek** (`/v1/gesprekken/*`): gesprekken + geordende berichten
   (`gesprek_contracts.py`/`gesprek_store.py`/`routers/gesprekken.py`). Anders dan het annotatie-domein
   **per-gebruiker gescopet** via de vertrouwde `X-User-Id`-header (`huidige_userid`, hergebruikt uit
   de auth-router; 404 op andermans gesprek). Een bericht kan naar een annotatie-document verwijzen
   (`annotatie_slug`); de review-state zelf blijft in het annotatie-domein.
3. **Login + gebruikersbeheer** (`/v1/auth/*` + `/v1/admin/users`): de API is de identiteitsbron van
   de webapp (userid + wachtwoord, rollen, optionele TOTP-2FA).
4. **LLM-modelprofielbeheer** (`/v1/admin/profiles`).
5. De **profiel-keuzelijst** voor de UI (`/v1/profiles`).

> **De analyse-pijplijn is verwijderd.** De oude `/v1/projects`-werkstroom (analyses aanmaken/
> reviewen/rapporteren), de act-2-generatie-engine (orchestrator, agent⇄tools-worker, GraphDB-bron,
> harde brongetrouwheid-/JAS-gate, de jobstore/rondes en de JAS-promotie naar de graaf) is uit de API
> gehaald toen niets die backend nog aanriep. De brongetrouwe QA/annotatie-agent zelf is een **aparte
> dienst** (`tools/graph-qa/`) met een eigen toollaag en LLM-config; de werkplek praat er direct mee
> (SSE) en is hier niet gewijzigd. Herbouw van een agentische analyse-flow gebeurt later, elders.

> **Geen wettenbank-MCP meer.** De werkplek haalt wettekst uit de graaf (graph-qa `GET /v1/artikel`),
> dus de wet-keuzelijst, de structuur/artikel-lookups en de wet-catalogus zijn uit de API verwijderd
> (met `wettenbank.py`/`wet_info.py`/`wetten.py`/`wet_catalog.py`). De wettenbank-MCP-service blijft
> bestaan als databron voor het skill-spoor en de graaf-ingestie — niet als API-afhankelijkheid.

## Architectuur (app/)

- `config.py` — env-config + projectpaden (PROJECT_ROOT = repo-root).
- `auth.py` — per-client bearer-tokens (erft het MCP-patroon; fail-closed; constant-tijd).
  `require_admin` is een aparte, altijd-verplichte bearer voor `/v1/admin/*` (LLM-/
  gebruikersbeheer). `require_admin` is **async** en accepteert twee bronnen: de statische
  env-admin-tokens (`WETSANALYSE_ADMIN_TOKENS`) én **genereerbare DB-tokens** (`api_tokens.py`,
  beheerd via `/beheer` → API-tokens). Die tokens staan **alleen als sha256-hash** in de
  `api_tokens`-tabel, worden één keer bij aanmaken getoond en zijn intrekbaar; ze voeden o.a. de
  admin-MCP (`tools/wetsanalyse-admin-mcp/`). Env-tokens blijven het bootstrap-pad.
- `user.py`/`users.py` + `routers/auth.py` — de **login-module**: de API is de identiteitsbron van de
  webapp. Inloggen gaat met de **`userid`** (de primaire sleutel van de `users`-tabel); `email` is een
  verplicht, uniek registratiegegeven (geen inlog-identiteit). Wachtwoord-hash via bcrypt, rollen
  `beheerder`/`analist`, optioneel TOTP-2FA versleuteld met dezelfde Fernet-key als de LLM-keys.
  `/v1/auth/*` (achter `require_client`) levert de BFF (Auth.js) login-verificatie (`/verify` op
  userid), de eenmalige eerste-beheerder-registratie (`/setup`, alleen bij lege tabel) en de
  self-service 2FA/account (`/2fa/*`, `/change-password`, identiteit via de vertrouwde
  `X-User-Id`-header van de BFF). De browsersessie zelf leeft in de frontend, niet hier.
- `llm_profile.py` — `LlmProfile`-domeinmodel (Pydantic; benoemde modelprofielen in de DB).
  `profiles.py` — service eroverheen: CRUD, default-beheer, `resolve_config` (profiel → `LlmConfig`,
  ontsleutelt de key, env-fallback) en `ensure_seeded` (seedt bij eerste start één default-profiel uit
  de env). `secrets_crypto.py` — Fernet-versleuteling-at-rest van de API-key (master key uit
  `LLM_CONFIG_SECRET(_FILE)`). De profielen worden beheerd via `/beheer` en gevalideerd met de
  verbindingstest; de QA-agent (graph-qa) heeft een eigen LLM-config en wordt er niet door aangestuurd.
- `db.py` — async SQLAlchemy-Core laag: engine-beheer + de tabeldefinities (`llm_profiles`,
  `users`, `api_tokens`, `annotatie_documenten`, `annotatie_audit`, `gesprekken`,
  `gesprek_berichten`). Portable types
  (`JSON`→`JSONB` op Postgres, `JSON` op SQLite-tests), tz-aware datetimes. `create_all` maakt bij de
  start alleen **ontbrekende tabellen** idempotent aan; er is **geen** auto-migratie van kolommen — een
  nieuwe/gewijzigde kolom op een bestaande tabel vergt een bewuste migratie (`ALTER TABLE`/Alembic) op
  productie.
- `llm/` — `LLMClient`-protocol + LiteLLM-implementatie (provider = config; `complete()` levert JSON
  conform een schema). `throttle.py` — proces-globale **concurrency-rem** (semafoor) op gelijktijdige
  LLM-calls (`WETSANALYSE_LLM_MAX_CONCURRENCY`); ingesteld in de lifespan. De enige LLM-call in deze
  API is nu de admin-**verbindingstest** (`POST /v1/admin/profiles/{name}/test`).
- `validation.py` — `GELDIGE_JAS_KLASSEN` (canonieke bron uit de skill-`references`) + de
  brongetrouwheid-/schema-helpers. Het annotatiedomein valideert de klasse van een voorgesteld element
  hiertegen.
- `ratelimit.py` — in-process per-client rate limit (dependency) + `QuotaExceeded`.
- `annotatie_contracts.py` — Pydantic-modellen + enums (`AnnotatieDocument`, `AnnotatieElement` met
  `lifecycle`/`beslissingen`/`alternatieven`/`aandacht`/`diff`, `Beslissing`, `AuditRecord`,
  `ReviewReason`). `annotatie_store.py` — `AnnotatieStore` (aparte store op dezelfde engine).
  `routers/annotatie.py` — `/v1/annotatie/*`, client-gescopet (`require_client` + `_document_or_404`).
  Levenscyclus: document aanmaken → `PUT elementen` (voorstellen van de agent; klasse gevalideerd tegen
  `validation.GELDIGE_JAS_KLASSEN`) → per element een human-decision (approve/edit/reject/comment;
  edit/reject vereisen `review_reason`; edit berekent een `diff`) → `GET audit`. Elke actie schrijft
  één auditregel. **Geen graaf-mutatie** vanuit dit domein.
- `routers/admin.py` — **`/v1/admin/*`** achter `require_admin`: modelprofielen-CRUD (write-only
  API-key, `api_key_set` nooit de key zelf), default zetten, verbinding testen; het gebruikersbeheer
  (`/users` CRUD, de laatste actieve beheerder is beschermd); en de genereerbare API-tokens
  (`/api-tokens`).
- `routers/catalog.py` — de niet-admin keuzelijst: `GET /v1/profiles` (alleen naam + default).
- `main.py` — routers + `/health` (liveness) + `/ready` (alleen booleans). De lifespan doet DB-init
  (met bounded connect-retry bij cold start), profiel-seeding en het instellen van de LLM-throttle.

## Observability

`app/observability.py` configureert **gestructureerde JSON-logging** (mirror van de MCP-logger:
`ts/niveau/categorie/bericht/…velden`, secret-redactie, `LOG_LEVEL`/`LOG_FORMAT`) plus **OpenTelemetry**
(traces/metrics/logs), gated op `OTEL_EXPORTER_OTLP_ENDPOINT` — leeg = no-op, alleen logs. `setup()`
draait vroeg in `main.py`; `RequestContextMiddleware` (pure ASGI, veilig voor SSE) zet een
`X-Request-Id` en logt per request. `get_tracer()`/`get_meter()` geven no-op-shims terug zonder de
`otel`-extra, dus code mag onvoorwaardelijk spans/metrics maken. Nooit tokens/secrets/prompt-inhoud
loggen. Zie `docs/observability.md`.

## Garanties (niet aan tornen)

- **Multi-tenant isolatie.** Elk annotatie-document is client-gescopet (404 op andermans slug); elk
  **gesprek** is per-gebruiker gescopet via de vertrouwde `X-User-Id`-header (404 op andermans id).
- **De admin-laag is altijd auth-plichtig.** `/v1/admin/*` heeft geen `AUTH_REQUIRED`-bypass; zonder
  admin-tokens geeft alles 401. De plaintext-API-key komt nooit terug in een respons (alleen
  `api_key_set`); het opslaan vereist een geconfigureerde Fernet-master-key.
- **Append-only auditlog.** Elke annotatie-actie schrijft één auditregel; de tijdlijn is `ORDER BY id`.
- **JAS-klassen zijn canoniek.** Een voorgesteld element wordt gevalideerd tegen
  `validation.GELDIGE_JAS_KLASSEN` — verzin er geen bij.
- **Secrets zijn bestanden.** Alle secrets (admin-tokens, client-tokens, DB-credentials, Fernet-key)
  staan als bestanden op de host (`*_FILE`-patroon) — nooit als plain env var.

## Lokaal draaien

### 1. Secrets aanmaken (eenmalig)

Maak `api/secrets/` aan (gitignored) en vul:

```powershell
# Vanuit de projectroot:
mkdir api\secrets
[IO.File]::WriteAllText("$PWD\api\secrets\api_tokens",       "lokaal:<zelfgekozen-token>")
# LLM-beheer (admin) — optioneel lokaal:
[IO.File]::WriteAllText("$PWD\api\secrets\admin_tokens",      "admin:<zelfgekozen-admin-token>")
[IO.File]::WriteAllText("$PWD\api\secrets\llm_config_secret", "<fernet-key>")
```

Fernet-master-key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.

### 2. `.env` aanmaken

Kopieer `.env.example` naar `.env` en vul in (Azure AI Foundry-config voor de verbindingstest/seed):

```
LLM_PROVIDER=azure_ai
LLM_MODEL=claude-sonnet-4-6
LLM_API_BASE=https://<resource-naam>.services.ai.azure.com   # geen /models achteraan
LLM_API_KEY_FILE=secrets/llm_api_key
WETSANALYSE_API_TOKENS_FILE=secrets/api_tokens
WETSANALYSE_ADMIN_TOKENS=admin:<zelfgekozen-admin-token>
LLM_CONFIG_SECRET=<fernet-key>   # nodig om API-keys via de admin-UI op te slaan
```

### 3. Server starten

```bash
cd api
uv sync --extra llm --extra dev
uv run --env-file .env uvicorn app.main:app --reload --port 3000
```

`uv run` laadt `.env` **niet** automatisch — de `--env-file .env` vlag is verplicht.
Swagger: `http://localhost:3000/docs` · health: `/health` · ready: `/ready`

Lokaal heb je ook een **PostgreSQL** nodig (de opslag). Snel:
`docker run -d -p 5432:5432 -e POSTGRES_USER=wetsanalyse -e POSTGRES_PASSWORD=wetsanalyse -e POSTGRES_DB=wetsanalyse postgres:16`
en zet `DATABASE_URL=postgresql+asyncpg://wetsanalyse:wetsanalyse@localhost:5432/wetsanalyse`. De
tabellen worden bij de start aangemaakt (`db.create_all` in de lifespan).

### 4. Testen

```bash
uv run pytest -q               # unit-tests (fakes; geen netwerk)
```

## Deployment

**Postgres draait in productie als APARTE stack** (`deploy/postgres/`), niet in de api-stack — zo
recreate een api-image-redeploy de DB nooit. De API verbindt cross-stack op `postgres:5432` met een
**bounded connect-retry** bij cold start (`main.py` → `_init_db_met_retry`, knoppen
`WETSANALYSE_DB_CONNECT_RETRIES`/`_BACKOFF`). De host-secrets (incl.
`postgres_user`/`postgres_password`/`database_url`) zijn gedeeld via `SECRETS_DIR`. Migratie +
volume-behoud: zie `deploy/postgres/README.md`.

Docker-image + Portainer-stack achter NPM, net als de MCP (`docker-compose.yml`). De dienst is
**horizontaal veilig** te schalen (stateless request-afhandeling; de opslag is de gedeelde DB). De
containers draaien **non-root** en **PostgreSQL draait met authenticatie**. Alle secrets staan als
bestanden op de host (`*_FILE`-patroon). Build vanaf de **projectroot**:
`docker build -f api/Dockerfile -t wetsanalyse-api .` (de image heeft de skill-`references/scripts`
nodig voor de canonieke JAS-klassenlijst).

### Secrets op de host (eenmalig, vóór de eerste stack-start)

De stack mount één host-map op `/run/secrets` in zowel de **api**- als de **postgres**-container. Het
pad komt uit de **GitHub Actions repo-variabele `SECRETS_DIR`**; de CI geeft die door aan Portainer.
Zet `SECRETS_DIR` exact op je host-pad, bijv. op een Synology NAS:
`/volume1/docker/wetsanalyse-api/secrets`.

Bestanden op de **host zelf** (niet via een laptop-mount):

```bash
SECRETS_DIR=/volume1/docker/wetsanalyse-api/secrets
sudo mkdir -p "$SECRETS_DIR"

echo -n "<llm-api-key>"      | sudo tee "$SECRETS_DIR/llm_api_key"      > /dev/null  # verbindingstest/seed
echo -n "id1:tok1,id2:tok2"  | sudo tee "$SECRETS_DIR/api_tokens"        > /dev/null

# Admin-laag: aparte admin-tokens + Fernet-master-key voor key-versleuteling.
echo -n "admin:adm-tok"      | sudo tee "$SECRETS_DIR/admin_tokens"      > /dev/null
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" \
    | sudo tee "$SECRETS_DIR/llm_config_secret" > /dev/null

# PostgreSQL-auth: credentials + de connection string die de API gebruikt.
PG_USER=wetsanalyse
PG_PASS="$(openssl rand -hex 24)"
echo -n "$PG_USER" | sudo tee "$SECRETS_DIR/postgres_user" > /dev/null
echo -n "$PG_PASS" | sudo tee "$SECRETS_DIR/postgres_password" > /dev/null
echo -n "postgresql+asyncpg://$PG_USER:$PG_PASS@postgres:5432/wetsanalyse" \
    | sudo tee "$SECRETS_DIR/database_url" > /dev/null

# De containers draaien non-root (postgres uid 999, api uid 10001). Gebruik 644 (NIET 600).
sudo chmod 755 "$SECRETS_DIR"
sudo chmod 644 "$SECRETS_DIR"/*
```

**Postgres-volume.** De postgres-image initialiseert de user/db alleen bij een *lege* data-dir. Wil je
verse credentials, verwijder het volume; wil je bestaande data behouden, laat de credentials (en de
`database_url`-secret) ongewijzigd.

### Troubleshooting deploy

- **API-log: kan niet verbinden met `localhost:5432` / `OperationalError`** — de `database_url`-secret
  werd niet gelezen (`/run/secrets` wijst naar de verkeerde map) → check `vars.SECRETS_DIR` en
  `docker inspect wetsanalyse-api --format '{{json .Mounts}}'`.
- **Postgres-log: `/run/secrets/postgres_password: Permission denied`, container `unhealthy`** —
  secret-bestanden niet leesbaar voor uid 999/10001 → `sudo chmod 644` op de host.

## Misbruik-/kostenbeheersing

Knoppen via env (0 = uit): `WETSANALYSE_RATE_LIMIT_MAX`/`_WINDOW` (per-client request-rate → 429),
`WETSANALYSE_ADMIN_TEST_RATE_MAX`/`_WINDOW` (aparte, krappe limiet op
`POST /v1/admin/profiles/{name}/test` → 429; die doet een betaalde LLM-call achter alleen het
admin-token — de testfout is gesaniteerd: een vaste melding in de respons, de ruwe provider-fout alleen
in het server-log), `WETSANALYSE_LLM_MAX_CONCURRENCY` (globaal plafond op gelijktijdige LLM-calls) en
`WETSANALYSE_LLM_TIMEOUT_S` (harde wandklok-timeout per LLM-call). De in-process rate-limiter is
begrensd (sweep + harde cap op het aantal sleutels, fail-closed) zodat aanvaller-gekozen sleutels via
de publieke login-route het geheugen niet vol pompen.

## Roadmap (nog niet gebouwd)

Per-gebruiker gescheiden werkruimtes (de gebruikersidentiteit doorvoeren tot in de scoping; nu delen
alle ingelogde gebruikers de upstream API-client van de BFF), externe IdP/OIDC, en de herbouw van een
agentische analyse-flow op de kennisgraaf (buiten deze API).
