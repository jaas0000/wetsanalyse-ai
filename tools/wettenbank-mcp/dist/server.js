#!/usr/bin/env node
/**
 * Wettenbank MCP Server — entry point
 * Registreert alle tools. De transport (StdIO of HTTP) wordt in index.ts gekozen.
 *
 * Tools:
 *   wettenbank_zoek      — Zoek regelingen op naam/type/ministerie
 *   wettenbank_structuur — Inhoudsopgave van een wet (NIEUW)
 *   wettenbank_artikel   — Haal één artikel op in Markdown-JSON
 *   wettenbank_zoekterm  — Full-text zoeken in een wet
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { buildInfo } from "./build-info.js";
import { handleZoek } from "./tools/zoek.js";
import { handleStructuur } from "./tools/structuur.js";
import { handleArtikel } from "./tools/artikel.js";
import { handleZoekterm } from "./tools/zoekterm.js";
import { log, veiligeToolVelden } from "./logger.js";
import { foutDetails, logNiveauVoor, metDeadline } from "./shared/fouten.js";
// Totale deadline per tool-call (begrenst o.a. de Promise.all in zoekterm); de
// per-fetch-timeouts in clients/http.ts blijven daarnaast bestaan.
const TOOL_TIMEOUT_MS = Number(process.env.WETTENBANK_TOOL_TIMEOUT_MS ?? 30_000);
// ── Server-factory ──────────────────────────────────────────────────────────
// createServer() bouwt een verse, volledig geconfigureerde Server. De stdio-modus
// gebruikt één singleton (export `server` onderaan); de HTTP-modus maakt per sessie
// een eigen instantie, omdat een Server 1-op-1 aan één transport is gekoppeld.
export function createServer(ctx = {}) {
    const server = new Server({ name: "wettenbank-mcp", version: buildInfo.version }, { capabilities: { tools: {} } });
    // ── Tool-definities ─────────────────────────────────────────────────────────
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "wettenbank_zoek",
                description: "Zoek Nederlandse regelingen op naam en retourneer BWB-id + metadata. " +
                    "Gebruik dit als eerste stap om het BWB-id van een wet te achterhalen.",
                inputSchema: {
                    type: "object",
                    properties: {
                        titel: {
                            type: "string",
                            description: "Zoekterm in de titel, bijv. 'Invorderingswet'",
                        },
                        rechtsgebied: {
                            type: "string",
                            description: "bijv. belastingrecht, arbeidsrecht",
                        },
                        ministerie: {
                            type: "string",
                            description: "bijv. Financiën, Justitie",
                        },
                        regelingsoort: {
                            type: "string",
                            enum: ["wet", "AMvB", "ministeriele-regeling", "regeling", "besluit"],
                        },
                        maxResultaten: { type: "number", default: 10 },
                        peildatum: {
                            type: "string",
                            description: "Datum YYYY-MM-DD; default is vandaag.",
                        },
                    },
                },
            },
            {
                name: "wettenbank_structuur",
                description: "Haal de inhoudsopgave op van een Nederlandse wet: hoofdstukken, afdelingen, " +
                    "paragrafen en bijbehorende artikelnummers — zonder artikeltekst. " +
                    "Gebruik dit om gericht te navigeren voordat je wettenbank_artikel aanroept.",
                inputSchema: {
                    type: "object",
                    required: ["bwbId"],
                    properties: {
                        bwbId: {
                            type: "string",
                            description: "BWB-id, bijv. BWBR0004770",
                        },
                        peildatum: {
                            type: "string",
                            description: "Datum YYYY-MM-DD; default is vandaag.",
                        },
                    },
                },
            },
            {
                name: "wettenbank_artikel",
                description: "Haal één artikel op uit een Nederlandse wet in schone Markdown. " +
                    "Retourneert alle leden met platte tekst, links en tabellen. " +
                    "Gebruik wettenbank_structuur eerst om het juiste artikelnummer te bepalen.",
                inputSchema: {
                    type: "object",
                    required: ["bwbId", "artikel"],
                    properties: {
                        bwbId: {
                            type: "string",
                            description: "BWB-id, bijv. BWBR0004770",
                        },
                        artikel: {
                            type: "string",
                            description: "Artikelnummer, bijv. '25' of '3:40'.",
                        },
                        lid: {
                            type: "string",
                            description: "Optioneel lidnummer; geeft alleen dat lid terug.",
                        },
                        peildatum: {
                            type: "string",
                            description: "Datum YYYY-MM-DD; default is vandaag.",
                        },
                    },
                },
            },
            {
                name: "wettenbank_zoekterm",
                description: "Zoek welke artikelen een begrip bevatten in één Nederlandse wet. " +
                    "Ondersteunt wildcards (*termijn*) en booleaanse operatoren (EN / OF). " +
                    "Stel includeerTekst=true in om direct de artikeltekst mee te krijgen.",
                inputSchema: {
                    type: "object",
                    required: ["bwbId", "zoekterm"],
                    properties: {
                        bwbId: {
                            type: "string",
                            description: "BWB-id, bijv. BWBR0004770",
                        },
                        zoekterm: {
                            type: "string",
                            description: "Te zoeken begrip. Wildcards: termijn* of *termijn*. " +
                                "Booleaans: 'uitstel EN belasting' of 'termijn OR afstel'.",
                        },
                        peildatum: {
                            type: "string",
                            description: "Datum YYYY-MM-DD.",
                        },
                        maxResultaten: {
                            type: "number",
                            default: 10,
                            description: "Maximum aantal artikelen in het resultaat (1-50).",
                        },
                        includeerTekst: {
                            type: "boolean",
                            default: false,
                            description: "Voeg de artikeltekst toe aan elk resultaat. " +
                                "Bespaart een extra wettenbank_artikel-aanroep.",
                        },
                    },
                },
            },
        ],
    }));
    // ── Tool-handlers ───────────────────────────────────────────────────────────
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const start = Date.now();
        // Gedeelde audit-velden: wie (clientId/sessionId), welke tool, welke wet/artikel.
        const auditBasis = {
            tool: name,
            clientId: ctx.clientId,
            sessionId: ctx.getSessionId?.(),
            ...veiligeToolVelden(args),
        };
        try {
            let werk;
            if (name === "wettenbank_zoek") {
                werk = handleZoek(args);
            }
            else if (name === "wettenbank_structuur") {
                werk = handleStructuur(args);
            }
            else if (name === "wettenbank_artikel") {
                werk = handleArtikel(args);
            }
            else if (name === "wettenbank_zoekterm") {
                werk = handleZoekterm(args);
            }
            else {
                log("warn", "audit", "onbekende tool aangeroepen", {
                    ...auditBasis,
                    uitkomst: "onbekend",
                });
                return {
                    content: [{ type: "text", text: `Onbekende tool: ${name}` }],
                    isError: true,
                };
            }
            const text = await metDeadline(werk, TOOL_TIMEOUT_MS, name);
            log("info", "audit", "tool aangeroepen", {
                ...auditBasis,
                uitkomst: "ok",
                duur_ms: Date.now() - start,
            });
            return { content: [{ type: "text", text }] };
        }
        catch (err) {
            // Gestructureerde, classificeerbare foutlog: oorzaak (cause-code), bron, host en
            // HTTP-status worden zichtbaar; permanente fouten (TLS/4xx) loggen op `error`.
            const d = foutDetails(err);
            log(logNiveauVoor(d.klasse), "audit", "tool gefaald", {
                ...auditBasis,
                uitkomst: "fout",
                fout: d.bericht,
                fout_code: d.code,
                fout_klasse: d.klasse,
                bron: d.bron,
                upstream_host: d.host,
                upstream_status: d.httpStatus,
                duur_ms: Date.now() - start,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ fout: d.bericht, foutCode: d.code, klasse: d.klasse }),
                    },
                ],
                isError: true,
            };
        }
    });
    return server;
}
// ── Exports ───────────────────────────────────────────────────────────────────
// Singleton voor de stdio-startup in index.ts; StdioServerTransport wordt
// doorgegeven zodat index.ts de startup afhandelt.
export const server = createServer();
export { StdioServerTransport };
