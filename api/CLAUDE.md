# CLAUDE.md — wetsanalyse-api

Headless API-backend die de Wetsanalyse (JAS) orchestreert. Maakt van de Claude Code-skill een
zelfstandige, Dockeriseerbare dienst die je via HTTP (Postman/Swagger) bevraagt. Lees ook de
projectroot-`CLAUDE.md` en `.claude/skills/wetsanalyse/SKILL.md` (de skill blijft de inhoudelijke
bron; deze service is een parallelle harness over dezelfde references/scripts).

## Dragend principe

De **orchestrator bezit de review-lus en de state**; het **LLM doet per stap één begrensde taak**
("geef JSON conform schema"). **Stap 1 (ophalen) is deterministisch via de MCP** — geen LLM-tool-
calling. De **jobstore is PostgreSQL** (SQLAlchemy async/asyncpg): één `projects`-rij per analyse met de
state + telemetrie en het `rapport` (JSONB-kolom); de immutabele analyse-rondes + feedback staan in een
aparte `rondes`-tabel. De API schrijft *niet* naar de `analyses/<id>/werk/`-disk; de
disk-interoperabiliteit met de lokale skill staat op de roadmap, niet in de huidige flow.

## Architectuur (app/)

- `config.py` — env-config + projectpaden (PROJECT_ROOT = repo-root).
- `contracts.py` — Pydantic-modellen (1-op-1 met `references/review-checkpoints.md`) + `Job`/state machine.
  `JobSummary` draagt ook de observerende `current_fase`(`_sinds`) + telemetrie, zodat het dashboard al
  bij de eerste render compleet is zonder per-job na te laden.
- `auth.py` — per-client bearer-tokens (erft het MCP-patroon; fail-closed; constant-tijd).
  `require_admin` is een aparte, altijd-verplichte bearer voor `/v1/admin/*` (LLM-beheer).
- `llm_profile.py` — `LlmProfile`-domeinmodel (Pydantic; benoemde modelprofielen in de DB; vervangt de
  vroegere hardcoded `Settings.model_profiles`). `profiles.py` — service eroverheen: CRUD,
  default-beheer, `resolve_config` (profiel → `LlmConfig`, ontsleutelt de key, env-fallback) en
  `ensure_seeded` (seedt bij eerste start één default-profiel uit de env). `secrets_crypto.py` —
  Fernet-versleuteling-at-rest van de API-key (master key uit `LLM_CONFIG_SECRET(_FILE)`).
  `usage.py` — read-only token-verbruik-aggregatie over `provenance`.
- `db.py` — async SQLAlchemy-Core laag: engine-beheer + de tabeldefinities (`projects`, `rondes`,
  `llm_profiles`, `wet_catalogus`). Portable types (`JSON`→`JSONB` op Postgres, `JSON` op SQLite-tests),
  tz-aware datetimes (`aware()` normaliseert het naïeve SQLite-resultaat naar UTC).
- `jobstore.py` — `JobStore`-Protocol (opslag-abstractie) + `IdConflict`. `postgres_store.py` —
  de SQLAlchemy/PostgreSQL-implementatie: gerichte kolom-writes, **ronde-immutabiliteit**, client-scoping,
  en de **state-CAS** (`claim`/`verleng_lease`/`lijst_verlopen_running`/`markeer_lease_loze_running`) via
  één atomair `UPDATE … RETURNING`. `set_current_fase()` is een **owner-fenced** update dat alléén het
  observerende `current_fase`(`_sinds`) bijwerkt en `updated`, `state` en `lease` ongemoeid laat (geen
  state-CAS, geen lease-bump).
- `project.py` — het `Project`-domeinmodel (Pydantic; state + telemetrie + `rapport`; de rondes/feedback
  leven in de aparte `rondes`-tabel; `owner`/`lease_until` voor de concurrency-claim, alleen door
  `claim`/heartbeat beheerd — nooit via `save_job`).
  Daarnaast twee **observerende** velden — `current_fase` + `current_fase_sinds` — die de fijnmazige
  functiestap binnen een `*-runt`/`bouwt`-state tonen (bv. `llm-generatie`, `verwijzingen-volgen`,
  `brongetrouwheid-check`). Dit is **geen** state-machine-veld: het staat los van de state-CAS en heeft
  geen control-flow-effect; bij review/terminal/fout gaat het op `None`.
- `wettenbank.py` — MCP-client; lege/fout-respons → `WettenbankError` (nooit doorgaan met lege context).
- `validation.py` — **zacht** (skill-`check_activiteit_2/3`, schema) vs **hard** (brongetrouwheid: citaat
  letterlijk in leden-tekst na normalisatie, `vindplaats`/`bronreferentie` verplicht).
- `ratelimit.py` — in-process per-client rate limit (dependency) + `QuotaExceeded` (beleidsgrenzen).
- `llm/` — `LLMClient`-protocol + LiteLLM-implementatie (provider = config; output-strategie + parse).
  `throttle.py` — proces-globale **concurrency-rem** (semafoor) op gelijktijdige LLM-calls
  (`WETSANALYSE_LLM_MAX_CONCURRENCY`), tegen zelf-veroorzaakte rate-limits; ingesteld in de lifespan.
- `engine/` — `prompts.py` (references verbatim + canonieke JAS-lijst uit validation), `steps.py`
  (LLM-stap + merge met brongetrouwe MCP-basis), `retry.py` (bounded backoff op transiënte
  LLM/MCP-fouten; honoreert **`Retry-After`** bij een 429, met plafond + jitter), `orchestrator.py`
  (state machine, auto-correctie, 6-rondencap, startup-reconciliatie, retry, quota/budget-checks).
  **Activiteit 2 is twee-fase** voor de cross-referenties: een verwijzing-inventaris
  (`steps.inventariseer_verwijzingen` / `prompts.act2_inventaris_prompt`) → begrensde fetch-lus
  (`orchestrator._volg_verwijzingen` + `wettenbank.parse_jci`) → de volledige act-2 met de
  opgehaalde verwezen tekst als context (zie §Roadmap → Cross-referenties). `_set_fase()` schrijft
  best-effort de observerende `current_fase` weg op breekpunten in `_genereer()`/`_bouw_rapport()`
  (geen control-flow-effect; faalt stil) en wist 'm bij review/terminal/fout.
- `routers/projects.py` + `main.py` — de kanonieke resource onder **`/v1/projects`** (client-gescopet,
  `response_model`s, paginatie, SSE), `/health` (liveness), `/ready` (alleen booleans). De per-project
  SSE (`/{id}/events`) is verrijkt met `current_fase`; daarnaast is er een **aggregate-stream**
  `GET /v1/projects/events` (client-gescopet, één diff-emit per gewijzigd project + `removed`-events)
  die het live dashboard én de projectenlijst voedt. Die route is **bewust vóór `/{project_id}`**
  geregistreerd zodat `events` niet als project-id wordt opgevat; `_dashboard_poll` zit apart voor
  testbaarheid. Beide SSE-loops sturen bij een stille poll een `: keep-alive`-heartbeat, anders breekt
  de undici-fetch in de Next.js-BFF de stream met `UND_ERR_BODY_TIMEOUT`.
- `wet_catalog.py` — `WetCatalogus`-domeinmodel (Pydantic, persistentie via de store; BWB-id +
  leesbare naam). `wetten.py` — service
  eroverheen: CRUD + `resolve_naam` (officiële citeertitel via `wettenbank_structuur`). De catalogus
  is een **gemak voor de UI-dropdown, niet dwingend**: de orchestrator dwingt geen lidmaatschap af en
  een willekeurige BWB-id blijft geldig. De wet-naam in het rapport komt los hiervan uit de MCP.
- `routers/admin.py` — **`/v1/admin/*`** achter `require_admin`: modelprofielen-CRUD
  (`/profiles`, write-only API-key, `api_key_set` nooit de key zelf), default zetten, verbinding
  testen, `/usage` (token-verbruik), en de wet-catalogus (`/wetten` CRUD + `/wetten/{bwbId}/resolve`).
  De engine bouwt per analyse de LLM-client uit het profiel van de job, dus runtime-wijzigingen
  werken zonder redeploy. De niet-admin keuzelijsten (`/v1/profiles`, `/v1/wetten`) staan in
  `routers/catalog.py` zodat de frontend de dropdowns zonder admin-token vult.

## Garanties (niet aan tornen)

- HARD brongetrouwheid faalt → job naar `fout`, **ook in `review:false`**. Nooit stil `klaar`.
- Auto-correctie is **geen ronde**: her-genereren binnen één ronde vóór het wegschrijven.
- Feedback alleen via de API en alleen in een `wacht-op-review-*`-state (anders 409).
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
WETSANALYSE_ADMIN_TOKENS=admin:<zelfgekozen-admin-token>
LLM_CONFIG_SECRET=<fernet-key>   # nodig om API-keys via de admin-UI op te slaan
```

Genereer de Fernet-master-key met:
`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.

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

**Geen vrije model-string vanuit de client**: kies een `model_profile` (benoemd, beheerd in de DB via
`/v1/admin/profiles` of het `/beheer`-scherm in de frontend); het feitelijk gebruikte model wordt per
ronde in de `provenance` van de `projects`-rij vastgelegd (audit). De env-`LLM_*`-waarden seeden
alleen het eerste default-profiel en blijven de fallback-key.

Lokaal heb je ook een **PostgreSQL** nodig (de jobstore). Snel:
`docker run -d -p 5432:5432 -e POSTGRES_USER=wetsanalyse -e POSTGRES_PASSWORD=wetsanalyse -e POSTGRES_DB=wetsanalyse postgres:16`
en zet `DATABASE_URL=postgresql+asyncpg://wetsanalyse:wetsanalyse@localhost:5432/wetsanalyse`. De
tabellen worden bij de start aangemaakt (`db.create_all` in de lifespan).

### Lokaal met Docker

Maak `api/docker-compose.override.yml` aan (gitignored) om de secrets-mount naar `./secrets` te
verwijzen in plaats van het productiepad. Voor lokaal draaien heb je naast `llm_api_key`,
`wettenbank_token` en `api_tokens` ook `database_url`, `postgres_user` en `postgres_password`
in `./secrets` nodig (zie de productie-stappen hieronder). Voor het LLM-beheer bovendien
`admin_tokens` en `llm_config_secret` — ontbreken die, dan boot de API gewoon, maar geeft
`/v1/admin/*` 401 (geen admin-tokens) en kun je geen API-key via de UI opslaan (geen master key):

```yaml
services:
  wetsanalyse-api:
    volumes:
      - ./secrets:/run/secrets:ro
  postgres:
    volumes:
      - ./secrets:/run/secrets:ro
```

Daarna: `docker compose up --build` vanuit `api/`. Er is geen `analyses/`-volume meer — de jobstore
is PostgreSQL.

## Deployment

Docker-image + Portainer-stack achter NPM, net als de MCP (`docker-compose.yml`). De dienst is
**horizontaal schaalbaar**: state-transities lopen via een atomaire **state-CAS** (`store.claim`, één
`UPDATE … RETURNING`), dus `--workers >1` en `deploy.replicas >1` zijn veilig. Een geclaimde job draagt
een `owner` + `lease_until`; de owner houdt de lease vers (heartbeat) en schrijft fenced (alleen zolang
hij de job bezit), en een periodieke **reaper** ruimt jobs met een verlopen lease op (crashende worker →
job naar `fout`, herstelbaar via `retry`). Knoppen: `WETSANALYSE_LEASE_S` (default 120) en
`WETSANALYSE_REAPER_INTERVAL_S` (default 60; 0 = uit). Kies de lease ruim langer dan de langste
realistische staptijd. De containers draaien **non-root** en **PostgreSQL draait met authenticatie**. Alle secrets (LLM-key, tokens, DB-credentials, connection string) staan
als bestanden op de host (`*_FILE`-patroon) — nooit als plain env var in de container of Portainer-UI.
Build vanaf de **projectroot**: `docker build -f api/Dockerfile -t wetsanalyse-api .` (de image heeft de
skill-`references/scripts` nodig). `POST /v1/projects` is async (202 + polling) — nooit synchroon achter
NPM's ~60s timeout.

### Secrets op de host (eenmalig, vóór de eerste stack-start)

De stack mount één host-map op `/run/secrets` in zowel de **api**- als de **postgres**-container. Het pad
komt uit de **GitHub Actions repo-variabele `SECRETS_DIR`** (Settings → Variables → Actions); de CI
geeft die door aan Portainer, dat `${SECRETS_DIR}` in de compose invult. **Staat de variabele leeg,
dan gebruikt de CI een default-pad en mount je de verkeerde map** → secrets onvindbaar (zie
Troubleshooting). Zet `SECRETS_DIR` dus exact op je host-pad, bijv. op een Synology NAS:
`/volume1/docker/wetsanalyse-api/secrets`.

Zes bestanden, aangemaakt op de **host zelf** (niet via een laptop-mount — die neemt de Unix-perms
vaak niet over):

```bash
SECRETS_DIR=/volume1/docker/wetsanalyse-api/secrets    # = de waarde van vars.SECRETS_DIR
sudo mkdir -p "$SECRETS_DIR"

echo -n "<llm-api-key>"      | sudo tee "$SECRETS_DIR/llm_api_key"      > /dev/null
echo -n "<wettenbank-token>" | sudo tee "$SECRETS_DIR/wettenbank_token"  > /dev/null
echo -n "id1:tok1,id2:tok2"  | sudo tee "$SECRETS_DIR/api_tokens"        > /dev/null

# Admin-laag (LLM-modelprofielen): aparte admin-tokens + Fernet-master-key voor key-versleuteling.
echo -n "admin:adm-tok"                                   | sudo tee "$SECRETS_DIR/admin_tokens"      > /dev/null
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" \
    | sudo tee "$SECRETS_DIR/llm_config_secret" > /dev/null

# PostgreSQL-auth: credentials + de connection string die de API gebruikt.
# Hex-wachtwoord = URL-veilig (geen +/=/ die je in de connection string moet escapen).
PG_USER=wetsanalyse
PG_PASS="$(openssl rand -hex 24)"
echo -n "$PG_USER" | sudo tee "$SECRETS_DIR/postgres_user" > /dev/null
echo -n "$PG_PASS" | sudo tee "$SECRETS_DIR/postgres_password" > /dev/null
echo -n "postgresql+asyncpg://$PG_USER:$PG_PASS@postgres:5432/wetsanalyse" \
    | sudo tee "$SECRETS_DIR/database_url" > /dev/null

# BELANGRIJK: de containers draaien non-root (postgres uid 999, api uid 10001). De bestanden zijn
# eigendom van je host-user, dus de container-users lezen ze alleen via de "other"-bit. Gebruik
# 644 (NIET 600 — dat geeft "Permission denied" in de container en postgres start niet).
sudo chmod 755 "$SECRETS_DIR"
sudo chmod 644 "$SECRETS_DIR"/*
```

**Postgres-volume.** De postgres-image initialiseert de user/db alleen bij een *lege* data-dir. Een
schone start is het simpelst: bestaat het `wetsanalyse-api_wetsanalyse_postgres`-volume al en wil je
verse credentials, verwijder het dan
(`docker rm -f wetsanalyse-postgres && docker volume rm wetsanalyse-api_wetsanalyse_postgres`). Wil je
*bestaande data* behouden, laat dan de credentials (en daarmee de `database_url`-secret) ongewijzigd.

Rotatie: pas het bestand aan en herstart (`docker restart wetsanalyse-api`); voor het Postgres-wachtwoord
ook de rol in Postgres bijwerken (`ALTER ROLE wetsanalyse WITH PASSWORD '…'`) én de `database_url`-secret.
CI stuurt geen geheime waarden naar Portainer — alleen niet-geheime config (`LLM_MODEL`, `LLM_PROVIDER`, e.d.)
en de niet-geheime `SECRETS_DIR`.

### Troubleshooting deploy

Symptoom → oorzaak:
- **API-log: kan niet verbinden met `localhost:5432` / `OperationalError`** — de `database_url`-secret werd
  niet gelezen (config viel terug op de default). Vrijwel altijd: `/run/secrets` wijst naar de verkeerde
  map → check `vars.SECRETS_DIR` en `docker inspect wetsanalyse-api --format '{{json .Mounts}}'`.
- **Postgres-log: `/run/secrets/postgres_password: Permission denied`, container `unhealthy`** —
  secret-bestanden niet leesbaar voor uid 999/10001 → `sudo chmod 644` op de host (zie boven).
- **Portainer stack-update HTTP 500** — meestal een container die niet start (een van bovenstaande);
  kijk in de containerlogs (`docker logs wetsanalyse-postgres` / `wetsanalyse-api`), niet alleen in de CI.

## Misbruik-/kostenbeheersing

Knoppen via env (0 = uit): `WETSANALYSE_RATE_LIMIT_MAX`/`_WINDOW` (per-client request-rate op de
muterende endpoints → 429), `WETSANALYSE_ADMIN_TEST_RATE_MAX`/`_WINDOW` (aparte, krappe limiet op
`POST /v1/admin/profiles/{name}/test` → 429; die doet een betaalde LLM-call achter alleen het
admin-token. De testfout is bovendien gesaniteerd: een vaste melding in de respons, de ruwe
provider-fout alleen in het server-log), `WETSANALYSE_MAX_ACTIVE_JOBS` (max gelijktijdig lopende analyses per
client → 429), `WETSANALYSE_LLM_TOKEN_BUDGET` (token-plafond per analyse → job naar `fout`,
`FoutKlasse.quota`), `WETSANALYSE_LLM_MAX_CONCURRENCY` (globaal plafond op gelijktijdige LLM-calls,
default 4 — de echte rem tegen provider-rate-limits), `WETSANALYSE_LLM_TIMEOUT_S` (harde wandklok-
timeout per LLM-call, default 120; 0 = uit — voorkomt dat een hangende provider-verbinding een
worker langer vasthoudt dan de lease), `WETSANALYSE_MAX_VERWIJZING_FETCHES` (cap op het aantal
verwezen artikelen dat per analyse wordt opgehaald in de cross-referentie-fetch-lus, default 6;
0 = niet volgen). Een 429 wordt bovendien geretryed met respect
voor de `Retry-After`-header (`WETSANALYSE_TRANSIENT_MAX_RETRIES`/`_BACKOFF`/`_MAX_BACKOFF`). Let op
bij >1 replica: de **rate limit** én de **LLM-concurrency-rem** zijn in-process (per replica → de
effectieve grens schaalt mee met het aantal replica's); **max-active-jobs** en het token-budget zijn
DB-/`provenance`-gebaseerd en dus accuraat over replica's heen. Multi-tenant isolatie is afgedwongen:
elke analyse is client-gescopet (404 op andermans id).

## Roadmap (nog niet gebouwd)

MS Teams-client; wet-only resolutie (nu is `bwbId` verplicht); echte job-queue (werk-distributie:
nu draait een analyse op de replica die het request kreeg — horizontaal schalen geeft spreiding van
verschillende analyses, geen parallellisme binnen één analyse); OIDC + per-gebruiker toegangscontrole
op de frontend (nu is `/beheer` alleen via het admin-token van de BFF afgeschermd, niet per
browser-sessie).

**Cross-referenties (gebouwd).** Activiteit 2 is twee-fase: een lichte inventaris-stap
(`prompts.act2_inventaris_prompt`, geeft per verwijzing `functie` + `volgen`) gevolgd door een
begrensde deterministische fetch-lus (`orchestrator._volg_verwijzingen`, diepte 1, cap
`WETSANALYSE_MAX_VERWIJZING_FETCHES`, gefaalde fetch degradeert stil), waarna het LLM in act-2b
`betekenis`/`status` brongetrouw invult met de opgehaalde tekst. `wettenbank.parse_jci` stuurt de
fetch; de MCP-getagde verwijzingen (per lid) voeden de inventaris. Het rapport draagt een
`verwijzingen`-array; begrippen kunnen via `bron_verwijzing` op een definitie-verwijzing steunen.
Diepere navolging (verwezen artikelen vól door de JAS-werkstroom halen i.p.v. alleen de tekst
meenemen) blijft toekomstwerk.

De **webapp** is inmiddels gebouwd: zie `frontend/` (Next.js BFF) — analyses aanmaken, reviewen, en
de LLM-modelprofielen beheren via `/beheer`.
