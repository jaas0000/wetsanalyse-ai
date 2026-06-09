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
// Transport-keuze: stdio (default, lokaal subproces) of http (langlevende service).
// Stuur via env MCP_TRANSPORT=http of CLI-flag `--transport http`.
function gekozenTransport() {
    const flagIndex = process.argv.indexOf("--transport");
    if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
        return process.argv[flagIndex + 1];
    }
    return process.env.MCP_TRANSPORT ?? "stdio";
}
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    if (gekozenTransport() === "http") {
        // Fail-closed: weiger te starten als de HTTP-service publiek bereikbaar is zonder
        // token. Bewust open draaien (bv. achter een vertrouwd netwerk) kan met MCP_ALLOW_NO_AUTH=1.
        if (!process.env.MCP_AUTH_TOKEN && process.env.MCP_ALLOW_NO_AUTH !== "1") {
            console.error("Weigering te starten: MCP_AUTH_TOKEN ontbreekt in HTTP-modus. " +
                "Zet een token, of MCP_ALLOW_NO_AUTH=1 om bewust zonder auth te draaien.");
            process.exit(1);
        }
        // Dynamische import: het stdio-pad laadt de HTTP-laag zo nooit.
        const { startHttpServer } = await import("./http-server.js");
        startHttpServer({
            port: Number(process.env.PORT ?? 3000),
            token: process.env.MCP_AUTH_TOKEN,
        });
    }
    else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}
// ── Re-exports voor backward-compatibiliteit (tests) ─────────────────────────
export { domParser, sruRequest, parseRecords, parseXmlDoc, dedupliceerOpBwbId, getElText, getAttr, stripXml, } from "./clients/sru-client.js";
export { xmlCache, haalWetstekstOp, extraheerDocMetadata, zoekElementInDom, zoekPadEnElementInDom, extractTextForSearch, } from "./clients/repository-client.js";
export { escapeerRegex, bouwTermPatroon, parseZoekterm, zoekTermInArtikelDom, } from "./search/zoekterm-engine.js";
