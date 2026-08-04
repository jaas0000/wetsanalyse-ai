# Ecosystems — waar te bumpen, hoe te regenereren

Per ecosystem: welke manifests, hoe transitives te forceren, wat de
regeneratie-commando's zijn.

## npm

**Direct-dep bump:** wijzig `dependencies`/`devDependencies` in
`package.json` en draai `npm install --package-lock-only`.

**Transitive bump via `overrides`:** wanneer een subdep kwetsbaar is die
geen directe dep van jou is. Voeg toe/verhoog in `overrides` in
`package.json`:

```json
"overrides": {
  "fast-uri": "^3.1.5",
  "hono": "^4.12.34",
  "@hono/node-server": "^2.0.5",
  "ip-address": "^10.3.1",
  "postcss": "^8.5.23"
}
```

Daarna `npm install --package-lock-only` en `npm audit --omit=dev` om te
verifiëren dat de lock daadwerkelijk de veilige versie draagt.

**GHSA-advisory-details opvragen (voor first-patched-version):**

```bash
gh api graphql -f query='{ securityAdvisory(ghsaId: "GHSA-xxxx-xxxx-xxxx") {
  summary
  vulnerabilities(first:5) { nodes {
    firstPatchedVersion { identifier }
    vulnerableVersionRange
  }}
}}'
```

Meerdere ranges → pin op de hoogste-fix in jouw major, niet blindelings de
laatste release (major-bump).

### npm-manifests in dit project

| Directory | package.json | Notities |
|---|---|---|
| `tools/wettenbank-mcp` | ja | Heeft `overrides` — hier landen SDK-transitives |
| `tools/wetsanalyse-admin-mcp` | ja | Sinds 2026-08-04 óók `overrides` |
| `frontend` | ja | Next.js — heeft eigen `overrides` (sharp, postcss) |
| `frontend-chat` | ja | Next.js — heeft eigen `overrides` |

## uv (Python)

**Direct-dep bump:** wijzig `pyproject.toml` en draai `uv lock`.

**Transitive bump:**

```bash
uv lock --upgrade-package <naam>
```

Uv kiest dan de laatst-compatibele versie binnen je constraints. Als je een
harde lower-bound wilt afdwingen zonder direct dep te worden, kan dat via
`[tool.uv]` constraints in `pyproject.toml`, maar dat is zelden nodig — de
`--upgrade-package`-flag volstaat meestal.

**Regeneratie inclusief installatie:**

```bash
uv sync --extra dev --extra llm
```

### uv-manifests in dit project

| Directory | pyproject.toml + uv.lock |
|---|---|
| `api` | ja — de wetsanalyse-API |
| `tools/graph-qa` | ja — de QA-agent |

## Docker (base image)

**Base-image-pin bumpen** in de `Dockerfile`:

```dockerfile
FROM python:3.12-slim              # bump de tag hier
```

Voor OS-CVE's (setuptools, msgpack in het `.venv`) is een expliciete
runtime-pin in de Dockerfile óók geldig:

```dockerfile
RUN pip install --no-cache-dir --upgrade 'pip>=26.1' 'setuptools>=78.1.1'
```

De Trivy-alert sluit pas als de image opnieuw gebouwd + gescand is. Trigger
via een commit op `master`; de docker-publish-workflows draaien Trivy op
digest en pushen SARIF naar de Security-tab.

### Dockerfiles in dit project

| Directory | Notities |
|---|---|
| `api/` | multi-stage, `python:3.12-slim`, pip+setuptools-upgrade |
| `frontend/` | Node-image, standalone build |
| `frontend-chat/` | Node-image |
| `tools/wettenbank-mcp/` | Node-image, non-root, HEALTHCHECK |
| `tools/graph-qa/` | Python-image, single-stage nu (uv builder-refactor open) |

## GitHub Actions

**Pin op commit-SHA**, niet op tag. Dependabot bumpt automatisch als je de
`# vX.Y.Z`-comment achter de SHA laat staan:

```yaml
- uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
```

Bump: nieuwe SHA opzoeken van de release-tag (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`) en het comment naar de nieuwe versie.

Dependabot doet dit automatisch als `github-actions` in `.github/dependabot.yml` staat (dat is zo — directory `/`).

## Wat waar geraakt wordt

Snelle vertaling van "een alert gaat over pakket X" → "welk manifest raakt
dat?":

| Package (voorbeeld) | Ecosystem | Manifest(s) |
|---|---|---|
| `aiohttp` | uv | `api/uv.lock` (transitief) |
| `cryptography` | uv | `api/uv.lock` |
| `fast-uri` | npm | overrides in `tools/*mcp/package.json` |
| `hono`, `@hono/node-server` | npm | overrides in `tools/*mcp/package.json` (SDK-transitief) |
| `ip-address` | npm | overrides in `tools/*mcp/package.json` (SDK-transitief) |
| `postcss` | npm | dev-dep + `overrides` in `frontend*/package.json` |
| `sharp` | npm | `overrides` in `frontend/package.json` |
| `setuptools`, `msgpack` (in `.venv`) | Trivy | Dockerfile-pin in `tools/graph-qa/Dockerfile` en `api/Dockerfile` |
