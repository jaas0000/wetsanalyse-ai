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

# Non-root gebruiker (uid 10002, naast api=10001 en mongo=999).
RUN groupadd --system --gid 10002 nodeapp \
    && useradd --system --uid 10002 --gid nodeapp nodeapp

# Standalone-server + statische assets. .next/static en public worden niet door de
# standalone-tracer meegekopieerd, dus expliciet plaatsen.
COPY --from=builder --chown=nodeapp:nodeapp /app/.next/standalone ./
COPY --from=builder --chown=nodeapp:nodeapp /app/.next/static ./.next/static
COPY --from=builder --chown=nodeapp:nodeapp /app/public ./public

USER nodeapp

EXPOSE 3000

# Healthcheck via Node's globale fetch (slim-image heeft geen curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js is het entrypoint van de standalone-build.
CMD ["node", "server.js"]
