# Postgres-stack (Wetsanalyse-API)

Aparte Portainer-stack voor de PostgreSQL-database van de API. **Los** van de api-stack, zodat een
api-image-redeploy de database nooit recreate — dat haalt de data-laag uit de blast-radius van de
Portainer-recreate-race (die anders postgres in `Created` kon achterlaten en meerdere
deploy-iteraties vergde).

## Deze stack maakt het gedeelde netwerk

`wetsanalyse_internal` (overschrijfbaar met `WA_NETWORK`) wordt hier aangemaakt; de api-, graph-qa-
en frontend-stack joinen erop als `external`. **Deploy deze stack dus als eerste van de vier** —
anders falen de andere op een ontbrekend extern netwerk. Zelfde patroon als `graphdb_default` bij de
graaf-stack.

- De API verbindt cross-stack op **`postgres:5432`** en heeft een **bounded connect-retry** bij cold
  start (`api/app/main.py` → `_init_db_met_retry`; knoppen `WETSANALYSE_DB_CONNECT_RETRIES`/
  `WETSANALYSE_DB_CONNECT_BACKOFF`), want een cross-stack `depends_on` bestaat niet.
- Secrets (`postgres_user`, `postgres_password`) leven als bestanden in **`SECRETS_DIR`** — dezelfde
  map als de api-stack, die de `database_url`-secret met dezelfde credentials leest.

## Deployen

Via Portainer (je Portainer) of de API, met deze stack-env:

| var | doel |
|---|---|
| `SECRETS_DIR` | host-pad naar de secrets-map (default `/opt/secrets/wetsanalyse-api`) |
| `WA_NETWORK` | naam van het gedeelde netwerk (default `wetsanalyse_internal`) |

Postgres initialiseert de user/db **alleen bij een lege data-dir**. De credentials uit de secrets
gelden dus vanaf de eerste start; wil je ze later wijzigen, dan is dat een `ALTER USER` in de
draaiende database, niet een nieuwe secret.

## Het volume

`wetsanalyse_postgres` wordt door deze stack beheerd en overleeft een image-update. Verwijder de
stack niet met *"remove volumes"* aangevinkt — dat is de database. Hernoem het volume ook niet: een
andere naam betekent een lege DB.

Back-up: de host gaat mee in de dagelijkse host-back-up. Voor een logische dump:

```bash
docker exec wetsanalyse-postgres \
  pg_dump -U "$(docker exec wetsanalyse-postgres cat /run/secrets/postgres_user)" wetsanalyse \
  | gzip > wetsanalyse-$(date +%F).sql.gz
```
