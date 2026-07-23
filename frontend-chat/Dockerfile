# Dockerfile voor de Juridische Assistent chat-frontend (Next.js, standalone output).
# Build-context = deze map (frontend-chat/).
# De app is een BFF: de browser praat alleen met deze server; tokens blijven server-side.

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:ffc78385a788964bb3cbab5e434ff79a10bdc25b8ae6db03fe5fe6cb14053c09 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:ffc78385a788964bb3cbab5e434ff79a10bdc25b8ae6db03fe5fe6cb14053c09 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:26-slim@sha256:ffc78385a788964bb3cbab5e434ff79a10bdc25b8ae6db03fe5fe6cb14053c09 AS runtime

ARG GIT_SHA=""
ARG BUILD_TIME=""

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME

WORKDIR /app

# OS-pakketten patchen (BIO2 / ISO 27002:2022 §8.8).
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Verwijder npm volledig — de standalone-runtime heeft het niet nodig en het levert CVE-alerts.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Non-root + read-only-fs-proof: groep 0, UID 10002.
RUN useradd --no-create-home --uid 10002 --gid 0 nodeapp

# Standalone-server + statische assets.
COPY --from=builder --chown=10002:0 /app/.next/standalone ./
COPY --from=builder --chown=10002:0 /app/.next/static ./.next/static
RUN chgrp -R 0 /app && chmod -R g=u /app

# Entrypoint laadt AUTH_SECRET uit een secret-bestand.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

ENV HOME=/tmp
USER 10002

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
