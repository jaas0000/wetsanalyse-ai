-- Read-only toegang voor Grafana tot de jobstore, t.b.v. het "Wetsanalyse — blauwdruk"-dashboard
-- (de live jobs-tabel die het opgeheven frontend-/dashboard vervangt).
--
-- LEAST PRIVILEGE: Grafana krijgt GEEN SELECT op `projects` zelf, maar alleen op de smalle VIEW
-- `dashboard_jobs` hieronder. Een view draait standaard met de rechten van zijn eigenaar
-- (security_invoker uit), dus de rol `grafana_ro` hoeft de onderliggende tabel niet te kunnen lezen.
-- Zo komt Grafana nooit bij `users`, `api_tokens`, `llm_profiles.enc_api_key`, prompts of rapporten.
--
-- EENMALIG DRAAIEN (de productie-DB draait op een BESTAAND volume, dus init-scripts lopen niet meer):
--   1) Zet een sterk wachtwoord in een host-secret, bv.:
--        openssl rand -hex 24 | sudo tee /volume1/docker/wetsanalyse-api/secrets/grafana_pg_password
--   2) Draai dit script als DB-owner en injecteer datzelfde wachtwoord:
--        PGPASS=$(cat /volume1/docker/wetsanalyse-api/secrets/grafana_pg_password)
--        docker exec -e PGPASS -i wetsanalyse-postgres \
--          psql -v ON_ERROR_STOP=1 -v grafana_pw="$PGPASS" \
--               -U "$(cat /run/secrets/postgres_user)" -d wetsanalyse < grafana-readonly.sql
--   3) Herhaal na een wachtwoordrotatie alleen het ALTER ROLE-gedeelte.
--
-- Idempotent: te herdraaien zonder fouten.

-- 1. Read-only rol (geen createdb/createrole/superuser). Wachtwoord via psql-variabele :grafana_pw.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grafana_ro') THEN
    CREATE ROLE grafana_ro LOGIN;
  END IF;
END
$$;
ALTER ROLE grafana_ro WITH PASSWORD :'grafana_pw';

-- 2. Smalle view met precies de kolommen die het dashboard toont. Tokens worden uit de
--    provenance-JSONB opgeteld; de status-bucket spiegelt statusBucket() uit frontend/lib/states.ts.
CREATE OR REPLACE VIEW dashboard_jobs AS
SELECT
    p.slug,
    p.naam,
    p.client_id,
    p.state,
    p.scope,
    p.current_activiteit,
    p.current_ronde,
    p.current_fase,
    p.current_fase_sinds,
    (p.error ->> 'klasse')  AS error_klasse,
    (p.error ->> 'bericht') AS error_bericht,
    COALESCE((SELECT sum((e ->> 'tokens_in')::bigint)
                FROM jsonb_array_elements(p.provenance) AS e), 0) AS tokens_in,
    COALESCE((SELECT sum((e ->> 'tokens_out')::bigint)
                FROM jsonb_array_elements(p.provenance) AS e), 0) AS tokens_out,
    CASE
        WHEN p.state IN ('queued', 'act2-runt', 'act3-runt', 'bouwt',
                         'rs-gegevens-runt', 'rs-regels-runt', 'rs-bouwt')            THEN 'lopend'
        WHEN p.state LIKE 'wacht-op-review-%'                                         THEN 'review'
        WHEN p.state IN ('klaar', 'rs-klaar')                                         THEN 'klaar'
        WHEN p.state = 'fout'                                                         THEN 'fout'
        ELSE 'overig'
    END AS bucket,
    p.created,
    p.updated
FROM projects AS p;

-- 3. Alleen SELECT op de view (niet op de tabel).
GRANT CONNECT ON DATABASE wetsanalyse TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON dashboard_jobs TO grafana_ro;
