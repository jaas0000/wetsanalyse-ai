FROM python:3.12-slim

WORKDIR /app

# Runtime-deps (gelijk aan pyproject.toml; geen build-tools nodig)
RUN pip install --no-cache-dir \
    anthropic \
    fastapi \
    "uvicorn[standard]" \
    httpx \
    pydantic \
    python-dotenv \
    sse-starlette \
    langgraph \
    langgraph-checkpoint-sqlite

COPY agent/ agent/
COPY api/ api/

# Non-root + /data voor de durable checkpointer-db (named volume; CHECKPOINT_DB_PATH=/data/...).
RUN useradd -u 10001 -m appuser && mkdir -p /data && chown appuser:appuser /data
USER appuser

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
