# Postgres-stack (Wetsanalyse-API)

Aparte Portainer-stack voor de PostgreSQL-database van de API. **Los** van de api-stack, zodat een
api-image-redeploy de database nooit recreate — dat haalt de data-laag uit de blast-radius van de
Portainer-recreate-race (die anders postgres in `Created` kon achterlaten en meerdere deploy-iteraties
vergde).

- De API verbindt cross-stack op **`postgres:5432`** (beide stacks op `homeinfra_internal`) en heeft
  een **bounded connect-retry** bij cold start (`api/app/main.py` → `_init_db_met_retry`; knoppen
  `WETSANALYSE_DB_CONNECT_RETRIES`/`WETSANALYSE_DB_CONNECT_BACKOFF`), want een cross-stack `depends_on`
  bestaat niet.
- Secrets (`postgres_user`, `postgres_password`) leven als bestanden in **`SECRETS_DIR`** — dezelfde
  map als de api-stack.
- De stack hergebruikt het **bestaande** named volume `wetsanalyse-api_wetsanalyse_postgres` als
  `external` (data behouden).

## Eenmalige migratie (bestaande omgeving: postgres verhuizen uit de api-stack)

De data blijft in het bestaande volume; we koppelen het alleen aan de nieuwe stack. Korte downtime
(~30–60s; de API retryt de verbinding). **Volgorde is kritisch** — twee postgres-containers mogen nooit
tegelijk op hetzelfde volume draaien, en de nieuwe stack mag pas worden aangemaakt als de oude
container **écht weg** is (zie de valkuil hieronder).

Gebruik het meegeleverde script (gehard tegen de trage-daemon-race):

```bash
PORTAINER_URL=https://portainer.ipalm.nl PORTAINER_API_KEY=<ptr-token> \
SECRETS_DIR=/volume1/docker/wetsanalyse-api/secrets \
  ./migrate.sh
```

Het doet: **volume-check → oude container stop + rm (poll tot echt weg) → nieuwe stack → health**.
Daarna: het geprinte **stack-id** als repo-var `PORTAINER_POSTGRES_STACK_ID` zetten, en de api-stack
redeployen met de bijgewerkte `api/docker-compose.yml` (zonder postgres — gaat vanzelf bij een merge
op master; de API reconnect via de retry).

> **Valkuil (waarom het script pollt):** op een trage host (bv. Synology) kan de `docker rm` via de
> reverse-proxy een 504 geven terwijl de daemon de container nog traag verwijdert. Maak je de nieuwe
> stack aan vóór de verwijdering klaar is, dan faalt de create op een **naam-conflict** en ligt de DB
> eruit. Het script wacht daarom tot de container weg is en **breekt veilig af vóór** de create als
> dat niet lukt.

**Rollback** (mocht het misgaan): het volume is ongemoeid. Start de oude container terug
(`POST /containers/<id>/start` of via Portainer) → de API reconnect en je draait weer op de originele
opzet.

> Verse omgeving (geen bestaand volume)? Vervang in de compose de `external: true`-regels tijdelijk
> door een gewoon named volume, of maak het volume vooraf aan. Postgres initialiseert dan een lege DB
> met de credentials uit de secrets; de API bouwt de tabellen op bij de eerste start.
