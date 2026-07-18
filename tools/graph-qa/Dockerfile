FROM python:3.12-slim

WORKDIR /app

# Runtime-deps (base uit pyproject.toml + de 'otel'-extra, zodat OTel werkt zodra
# OTEL_EXPORTER_OTLP_ENDPOINT gezet is; zonder die packages degradeert observability naar alleen
# JSON-logs zónder trace_id). Pip eerst upgraden zodat de base-image-pip (met bekende CVE's) niet in
# de image achterblijft — Trivy scant 'm anders als alert.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
    anthropic \
    fastapi \
    "uvicorn[standard]" \
    httpx \
    pydantic \
    python-dotenv \
    sse-starlette \
    langgraph \
    langgraph-checkpoint-sqlite \
    "opentelemetry-sdk>=1.29.0" \
    "opentelemetry-exporter-otlp>=1.29.0" \
    "opentelemetry-instrumentation-fastapi>=0.50b0" \
    "opentelemetry-instrumentation-httpx>=0.50b0"

COPY agent/ agent/
COPY api/ api/

# Non-root + /data voor de durable checkpointer-db (named volume; CHECKPOINT_DB_PATH=/data/...).
RUN useradd -u 10001 -m appuser && mkdir -p /data && chown appuser:appuser /data
USER appuser

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
