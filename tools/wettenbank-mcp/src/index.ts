#!/usr/bin/env node
/**
 * Entry point — backward-compatibele shim + startup.
 *
 * Claude Desktop en Claude Code CLI verwijzen naar dist/index.js.
 * Alle werkelijke logica zit in server.ts en de submodules.
 */

import { fileURLToPath } from "url";
import { server, StdioServerTransport } from "./server.js";
import { leesClients } from "./auth.js";
import { oidcConfigUitEnv } from "./oidc.js";

// ── Startup ───────────────────────────────────────────────────────────────────
// Transport-keuze: stdio (default, lokaal subproces) of http (langlevende service).
// Stuur via env MCP_TRANSPORT=http of CLI-flag `--transport http`.

function gekozenTransport(): string {
  const flagIndex = process.argv.indexOf("--transport");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  return process.env.MCP_TRANSPORT ?? "stdio";
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  if (gekozenTransport() === "http") {
    const clients = leesClients();
    const oidcAan = oidcConfigUitEnv() !== null;
    // Fail-closed: weiger te starten als de HTTP-service publiek bereikbaar is zonder
    // enige auth. Bewust open draaien (bv. achter een vertrouwd netwerk) kan met MCP_ALLOW_NO_AUTH=1.
    if (clients.length === 0 && !oidcAan && process.env.MCP_ALLOW_NO_AUTH !== "1") {
      console.error(
        "Weigering te starten: geen auth geconfigureerd in HTTP-modus. " +
          "Zet MCP_AUTH_TOKENS (id:token,...), MCP_AUTH_TOKEN, OIDC_ISSUER, " +
          "of MCP_ALLOW_NO_AUTH=1 om bewust zonder auth te draaien."
      );
      process.exit(1);
    }
    // Dynamische import: het stdio-pad laadt de HTTP-laag zo nooit.
    const { startHttpServer } = await import("./http-server.js");
    startHttpServer({
      port: Number(process.env.PORT ?? 3000),
      clients,
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// ── Re-exports voor backward-compatibiliteit (tests) ─────────────────────────

export {
  domParser,
  sruRequest,
  parseRecords,
  parseXmlDoc,
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
