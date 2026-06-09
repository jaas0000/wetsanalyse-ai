/**
 * Build-info — één bron van waarheid voor versie + herkomst van de draaiende build.
 *
 * `version` komt uit package.json (semver, ook gebruikt als MCP `serverInfo.version`).
 * `commit` en `builtAt` worden bij de Docker-build via env-vars geïnjecteerd
 * (zie Dockerfile + .github/workflows/docker-publish.yml). Lokaal/stdio — waar die
 * env-vars ontbreken — vallen ze terug op `"dev"`/`null`, zodat de waarden nooit liegen.
 *
 * Wordt geëxposeerd op het auth-vrije `/health`-endpoint, zodat deploy-pariteit
 * ("draait de container de verwachte commit?") met één request te controleren is.
 */
import { createRequire } from "module";
const { version } = createRequire(import.meta.url)("../package.json");
export const buildInfo = {
    version,
    commit: process.env.GIT_SHA || "dev",
    builtAt: process.env.BUILD_TIME || null,
};
