# Dockerfile voor de Wettenbank MCP-server.
# Build-context = deze map (tools/wettenbank-mcp/), dus paden zijn lokaal.
#   docker build -t wettenbank-mcp tools/wettenbank-mcp
# Default draait de server in HTTP-modus (Streamable HTTP op /mcp, poort 3000).
# Stel MCP_TRANSPORT=stdio in om in plaats daarvan als stdio-subproces te draaien.

# ── Build-fase ────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Eerst alleen de manifests → betere layer-caching bij ongewijzigde dependencies.
COPY package*.json tsconfig.json ./
RUN npm ci

# Broncode + TypeScript-build naar dist/.
COPY src ./src
RUN npm run build

# ── Runtime-fase ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3000

WORKDIR /app

# OS-pakketten patchen (BIO2 / ISO 27002:2022 §8.8). De base-image loopt soms achter
# op Debian-security-updates; `apt-get upgrade` haalt o.a. de libgnutls30-fix binnen.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Alleen productie-dependencies in de runtime-image.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Gecompileerde JS uit de build-fase.
COPY --from=builder /app/dist ./dist

# Draai als de non-root `node`-gebruiker uit de base image.
USER node

EXPOSE 3000

# Healthcheck via Node's globale fetch (de slim-image heeft geen curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
