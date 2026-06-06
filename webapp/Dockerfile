FROM node:20-slim AS mcp-builder

# Bouw de MCP-server (devDependencies nodig voor TypeScript)
WORKDIR /build
COPY tools/wettenbank-mcp/package.json tools/wettenbank-mcp/package-lock.json ./
RUN npm ci
COPY tools/wettenbank-mcp/ .
RUN npm run build
# Production-only install om image kleiner te maken
RUN npm ci --omit=dev

# ── Runtime image ──────────────────────────────────────────────────────────

FROM python:3.12-slim

# Installeer Node.js runtime (voor de MCP-server) — gepinde versie
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installeer Python dependencies
COPY webapp/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopieer de applicatie
COPY webapp/ .

# Kopieer de gebouwde MCP-server uit de builder stage
COPY --from=mcp-builder /build/dist/ /app/tools/wettenbank-mcp/dist/
COPY --from=mcp-builder /build/node_modules/ /app/tools/wettenbank-mcp/node_modules/

# Non-root user
RUN useradd --create-home appuser && \
    mkdir -p data && \
    chown -R appuser:appuser /app
USER appuser

# MCP-server pad
ENV MCP_SERVER_PATH=/app/tools/wettenbank-mcp/dist/index.js

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/')" || exit 1

# Expose poort
EXPOSE 8080

# Start de applicatie
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
