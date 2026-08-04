# Verificatie-checklist

Per project na een bump. Draai in deze volgorde; **stop bij de eerste
falende stap** en diagnose voordat je verder gaat.

Node.js is nodig voor de npm-projecten:
```bash
source /home/wet-admin/.nvm/nvm.sh   # of PATH-equivalent
```

## `tools/wettenbank-mcp`

```bash
cd tools/wettenbank-mcp
npm install                    # regenereert node_modules bij nieuwe overrides
npm audit --omit=dev           # verwachting: found 0 vulnerabilities
npm run build                  # tsc → dist/
npm test                       # vitest — verwacht 238 tests groen (of meer)
```

**Belangrijk:** `dist/` is gecommit; kijk met `git status` of `dist/` gewijzigd
is en commit die mee als de source dat vereist.

## `tools/wetsanalyse-admin-mcp`

```bash
cd tools/wetsanalyse-admin-mcp
npm install
npm audit --omit=dev
npm run build                  # tsc → dist/
```

Geen testsuite in dit tool. Verifieer minstens dat `dist/index.js` linked
tegen de nieuwe deps door 'm te starten:

```bash
node dist/index.js --help 2>&1 | head        # crasht niet = ok
```

## `frontend`

```bash
cd frontend
npm install
npm audit --omit=dev
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
npm run test                   # vitest
```

## `frontend-chat`

```bash
cd frontend-chat
npm install
npm audit --omit=dev
npm run typecheck              # tsc --noEmit
```

Geen dedicated testsuite; leun op typecheck.

## `api`

```bash
cd api
uv sync --extra dev --extra llm
uv run pytest -q               # verwacht 200+ tests groen
```

De pytest-suite gebruikt fakes voor MCP + LLM (geen netwerk). Als je de
mcp-client zelf hebt gebumpt, doe er een end-to-end MCP-round-trip
achteraan met een lokale `wettenbank-mcp`:

```bash
# terminal 1: MCP starten (HTTP-mode zonder auth voor test)
cd tools/wettenbank-mcp
MCP_TRANSPORT=http PORT=3300 MCP_ALLOW_NO_AUTH=1 node dist/index.js

# terminal 2: round-trip test
cd api
WETTENBANK_MCP_URL=http://localhost:3300/mcp WETTENBANK_TOKEN=noop \
  .venv/bin/python -c "
import asyncio
from app.config import get_settings
from app.wettenbank import WettenbankClient
async def main():
    wb = WettenbankClient(get_settings())
    data = await wb.artikel('BWBR0004770', '9', '1')
    print('OK', data.get('citeertitel'))
asyncio.run(main())
"
```

## `tools/graph-qa`

```bash
cd tools/graph-qa
uv sync --extra dev
uv run --extra dev pytest -q
uv run --extra dev python eval/run_eval.py --offline    # geen netwerk, geen kosten
```

## Cross-project sanity

Draai op de projectroot:

```bash
git status --short              # geen ongewenste files gestaged
git diff --stat --staged        # verwacht: alleen manifests + locks + fix-code
```

**Rode vlaggen:**
- `deploy/compose/` gestaged (bevat secrets — nooit committen)
- `.env` gestaged
- `tsconfig.tsbuildinfo` gestaged (build-cache, geen echt werk)
- `node_modules/` gestaged (`.gitignore` zou 'm moeten pakken)
