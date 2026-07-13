#!/bin/bash
# Initialiseert PostgreSQL eenmalig bij de eerste start, daarna start supervisord
# beide processen (postgres + uvicorn) op.
set -e

DATA_DIR=/var/lib/postgresql/data
DB_PASS=$(cat /run/secrets/postgres_password)

# ── Eerste start: initialiseer de database ────────────────────────────────────
if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
    echo "[entrypoint] Eerste start — PostgreSQL initialiseren..."
    install -d -o postgres -g postgres -m 0700 "$DATA_DIR"

    gosu postgres initdb \
        --pgdata="$DATA_DIR" \
        --username=postgres \
        --auth-local=trust \
        --auth-host=md5

    # Sta alleen lokale verbindingen toe (geen netwerk nodig).
    echo "host all all 127.0.0.1/32 md5" >> "$DATA_DIR/pg_hba.conf"

    # Tijdelijk opstarten om user + database aan te maken.
    gosu postgres pg_ctl start -D "$DATA_DIR" -w -o "-c listen_addresses=localhost"

    gosu postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE USER wetsanalyse WITH PASSWORD '${DB_PASS}';
CREATE DATABASE wetsanalyse OWNER wetsanalyse;
SQL

    gosu postgres pg_ctl stop -D "$DATA_DIR" -w
    echo "[entrypoint] Database geïnitialiseerd."
fi

# ── DATABASE_URL doorgeven aan de API-processen ───────────────────────────────
# supervisord erft de omgeving; de API leest DATABASE_URL direct (geen *_FILE nodig).
export DATABASE_URL="postgresql+asyncpg://wetsanalyse:${DB_PASS}@127.0.0.1:5432/wetsanalyse"

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/wetsanalyse.conf
