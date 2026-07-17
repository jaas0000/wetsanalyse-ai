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
(~30–60s; de API retryt de verbinding). **Volgorde is belangrijk** — twee postgres-containers mogen
nooit tegelijk op hetzelfde volume draaien.

1. **Oude postgres stoppen + verwijderen** (geeft het volume en de naam vrij; het volume zelf blijft):
   ```bash
   docker stop wetsanalyse-postgres && docker rm wetsanalyse-postgres
   ```
2. **Nieuwe postgres-stack deployen** in Portainer vanaf `deploy/postgres/docker-compose.yml`
   (stack-env `PROXY_NETWORK=homeinfra_internal`, `SECRETS_DIR=<host-pad>`). Postgres start op
   dezelfde data (external volume). Noteer het nieuwe **stack-id** → repo-var
   `PORTAINER_POSTGRES_STACK_ID`.
3. **Api-stack redeployen** met de bijgewerkte `api/docker-compose.yml` (zonder postgres-service). De
   API reconnect vanzelf via de retry en wordt `healthy`.

**Rollback** (mocht stap 2 falen): het volume is ongemoeid — zet tijdelijk de oude
`api/docker-compose.yml` (mét postgres-service) terug en redeploy de api-stack; je draait weer op de
originele opzet.

> Verse omgeving (geen bestaand volume)? Vervang in de compose de `external: true`-regels tijdelijk
> door een gewoon named volume, of maak het volume vooraf aan. Postgres initialiseert dan een lege DB
> met de credentials uit de secrets; de API bouwt de tabellen op bij de eerste start.
