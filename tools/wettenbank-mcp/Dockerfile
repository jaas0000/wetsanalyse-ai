# Dockerfile voor de Wettenbank MCP-server.
# Build-context = deze map (tools/wettenbank-mcp/), dus paden zijn lokaal.
#   docker build -t wettenbank-mcp tools/wettenbank-mcp
# Default draait de server in HTTP-modus (Streamable HTTP op /mcp, poort 3000).
# Stel MCP_TRANSPORT=stdio in om in plaats daarvan als stdio-subproces te draaien.

# ── Build-fase ────────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9 AS builder

WORKDIR /app

# Eerst alleen de manifests → betere layer-caching bij ongewijzigde dependencies.
COPY package*.json tsconfig.json ./
RUN npm ci

# Broncode + TypeScript-build naar dist/.
COPY src ./src
RUN npm run build

# ── Runtime-fase ──────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9 AS runtime

# Build-herkomst, door CI meegegeven (docker-publish.yml). ARG geldt per stage, dus
# hier opnieuw declareren; via ENV worden ze leesbaar voor de server (/health).
ARG GIT_SHA=""
ARG BUILD_TIME=""

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3000 \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    NODE_EXTRA_CA_CERTS=/app/certs/certsign-web-ca-chain.pem

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

# Ontbrekend tussencertificaat voor repository.officiele-overheidspublicaties.nl
# (incomplete upstream-keten → "fetch failed"). Via NODE_EXTRA_CA_CERTS (zie ENV) maakt
# Node de keten compleet, zonder TLS-verificatie uit te zetten. Zie certs/-bestand.
COPY certs ./certs

# Non-root + OpenShift-proof: maak /app groep-root-eigendom met groep=gebruiker-rechten, zodat de
# door OpenShift toegewezen WILLEKEURIGE UID (lid van groep 0) de code/certs kan lezen. HOME=/tmp
# (read_only root-fs + tmpfs/emptyDir). USER node (uid 1000) blijft de default voor compose;
# OpenShift overschrijft 'm met de namespace-UID.
RUN chgrp -R 0 /app && chmod -R g=u /app
ENV HOME=/tmp
USER node

EXPOSE 3000

# Healthcheck via Node's globale fetch (de slim-image heeft geen curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
