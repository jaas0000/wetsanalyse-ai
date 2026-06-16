# Dockerfile voor de Wetsanalyse-frontend (Next.js, standalone output).
# Build-context = deze map (frontend/), net als de MCP:
#   docker build -t wetsanalyse-frontend frontend
# De frontend is een BFF: de browser praat alleen met deze server; het API-token blijft
# server-side. De server bereikt de API intern via API_BASE_URL (proxy-netwerk).

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.mjs zet output: 'standalone' → .next/standalone bevat een minimale server.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9 AS runtime

ARG GIT_SHA=""
ARG BUILD_TIME=""

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

WORKDIR /app

# OS-pakketten patchen (BIO2 / ISO 27002:2022 §8.8), spiegelt de MCP-image.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# CVE-2026-53655: tar@7.5.15 gebundeld door npm zelf; upgrade npm zodat tar@>=7.5.16 meegaat.
RUN npm install -g npm@11.17.0 && npm cache clean --force

# Non-root + OpenShift-proof: lid van groep 0 i.p.v. een eigen gid. OpenShift restricted-v2 draait
# met een WILLEKEURIGE UID + gid 0, dus de bestanden zijn groep-root-eigendom met groep=gebruiker-
# rechten en de toegewezen UID kan lezen/uitvoeren. USER 10002 blijft de default (compose).
RUN useradd --no-create-home --uid 10002 --gid 0 nodeapp

# Standalone-server + statische assets. .next/static en public worden niet door de
# standalone-tracer meegekopieerd, dus expliciet plaatsen. Groep-root-eigendom + g=u.
COPY --from=builder --chown=10002:0 /app/.next/standalone ./
COPY --from=builder --chown=10002:0 /app/.next/static ./.next/static
COPY --from=builder --chown=10002:0 /app/public ./public
RUN chgrp -R 0 /app && chmod -R g=u /app

ENV HOME=/tmp
USER 10002

EXPOSE 3000

# Healthcheck via Node's globale fetch (slim-image heeft geen curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js is het entrypoint van de standalone-build.
CMD ["node", "server.js"]
