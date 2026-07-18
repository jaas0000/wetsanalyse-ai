FROM python:3.12-slim

WORKDIR /app

# Systeemdeps (geen build-tools nodig voor deze deps)
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

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
