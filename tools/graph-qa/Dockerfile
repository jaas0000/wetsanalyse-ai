FROM python:3.12-slim

WORKDIR /app

# Pip eerst upgraden zodat de base-image-pip (met bekende CVE's) niet in de image achterblijft —
# Trivy scant 'm anders als alert.
RUN pip install --no-cache-dir --upgrade pip 'setuptools>=78.1.1'

COPY pyproject.toml ./
COPY agent/ agent/
COPY api/ api/

# Installeren uit pyproject.toml, mét de 'otel'-extra (zodat OTel werkt zodra
# OTEL_EXPORTER_OTLP_ENDPOINT gezet is; zonder die packages degradeert observability naar alleen
# JSON-logs zónder trace_id).
#
# Bewust géén handmatig herhaalde pip-lijst hier: die liep uit de pas met pyproject.toml, waardoor
# langgraph-checkpoint-postgres en psycopg ontbraken en de agent bij een gezette CHECKPOINT_DB_URL
# omviel met "No module named 'langgraph.checkpoint.postgres'". Eén lijst, één bron van waarheid.
RUN pip install --no-cache-dir '.[otel]' "msgpack>=1.1.0"

# Non-root + /data voor de durable checkpointer-db (named volume; CHECKPOINT_DB_PATH=/data/...).
RUN useradd -u 10001 -m appuser && mkdir -p /data && chown appuser:appuser /data
USER appuser

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
