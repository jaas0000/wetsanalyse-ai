# Build-context = projectroot (de API leest de skill-references/scripts via PROJECT_ROOT).
# Bouwen vanaf de root:  docker build -f api/Dockerfile -t wetsanalyse-api .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.10 /uv /bin/uv

WORKDIR /app/api

# Eerst alleen de dependency-manifesten → betere layer-cache. --extra llm: de engine
# (LiteLLM + MCP-client) is in productie nodig; --no-dev laat de testtools weg.
COPY api/pyproject.toml /app/api/pyproject.toml
RUN uv sync --extra llm --no-dev

# Applicatiecode + de gedeelde skill-kennis (references/scripts). analyses/ is een volume.
COPY api /app/api
COPY .claude/skills/wetsanalyse /app/.claude/skills/wetsanalyse

ENV PATH="/app/api/.venv/bin:$PATH"

EXPOSE 3000

# Single worker: het concurrency-model leunt op per-job asyncio-locks + filesystem-state.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000", "--workers", "1"]
