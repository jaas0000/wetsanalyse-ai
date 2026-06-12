# Build-context = projectroot (de API leest de skill-references/scripts via PROJECT_ROOT).
# Bouwen vanaf de root:  docker build -f api/Dockerfile -t wetsanalyse-api .
# CI (api-docker-publish.yml) pusht de image naar GHCR; Portainer pullt :latest.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.10 /uv /bin/uv

WORKDIR /app/api

# Eerst alleen de dependency-manifesten → betere layer-cache. --extra llm: de engine
# (LiteLLM + MCP-client) is in productie nodig. De lock zorgt voor reproduceerbare builds.
COPY api/pyproject.toml api/uv.lock /app/api/
RUN uv sync --extra llm --frozen

# Applicatiecode + de gedeelde skill-kennis (references/scripts). analyses/ is een volume.
COPY api /app/api
COPY .claude/skills/wetsanalyse /app/.claude/skills/wetsanalyse

# Build-herkomst, door CI meegegeven → leesbaar voor de service op /health (deploy-pariteit).
ARG GIT_SHA=""
ARG BUILD_TIME=""
ENV PATH="/app/api/.venv/bin:$PATH" \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3000/health').status==200 else 1)"

# EXACT één worker: het concurrency-model serialiseert state-transities met per-job
# asyncio-locks (in-process). De jobstore is gedeeld (MongoDB), maar die lock werkt alleen
# binnen één proces — meerdere workers/replica's zouden de serialisatie doorbreken. Schaal
# pas op na een gedeelde lock (Mongo state-CAS) of een echte job-queue (zie roadmap).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000", "--workers", "1"]
