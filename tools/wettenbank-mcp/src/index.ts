#!/usr/bin/env node
/**
 * Entry point — backward-compatibele shim + startup.
 *
 * Claude Desktop en Claude Code CLI verwijzen naar dist/index.js.
 * Alle werkelijke logica zit in server.ts en de submodules.
 */

import { fileURLToPath } from "url";
import { server, StdioServerTransport } from "./server.js";

// ── Startup ───────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ── Re-exports voor backward-compatibiliteit (tests) ─────────────────────────

export {
  domParser,
  sruRequest,
  parseRecords,
  dedupliceerOpBwbId,
  getElText,
  getAttr,
  stripXml,
} from "./clients/sru-client.js";
export type { Regeling } from "./clients/sru-client.js";

export {
  xmlCache,
  haalWetstekstOp,
  extraheerDocMetadata,
  zoekElementInDom,
  zoekPadEnElementInDom,
  extractTextForSearch,
} from "./clients/repository-client.js";
export type { WetstekstResultaat, DocMetadata } from "./clients/repository-client.js";

export {
  escapeerRegex,
  bouwTermPatroon,
  parseZoekterm,
  zoekTermInArtikelDom,
} from "./search/zoekterm-engine.js";
export type { ZoekInput, ZoekTermResultaat } from "./search/zoekterm-engine.js";
