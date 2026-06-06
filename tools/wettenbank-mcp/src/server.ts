#!/usr/bin/env node
/**
 * Wettenbank MCP Server — entry point
 * Registreert alle tools en start de StdIO-transport.
 *
 * Tools:
 *   wettenbank_zoek      — Zoek regelingen op naam/type/ministerie
 *   wettenbank_structuur — Inhoudsopgave van een wet (NIEUW)
 *   wettenbank_artikel   — Haal één artikel op in Markdown-JSON
 *   wettenbank_zoekterm  — Full-text zoeken in een wet
 */

import { createRequire } from "module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const { version: pkgVersion } = createRequire(import.meta.url)(
  "../package.json"
) as { version: string };
import { handleZoek } from "./tools/zoek.js";
import { handleStructuur } from "./tools/structuur.js";
import { handleArtikel } from "./tools/artikel.js";
import { handleZoekterm } from "./tools/zoekterm.js";

// ── Server instantie ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "wettenbank-mcp", version: pkgVersion },
  { capabilities: { tools: {} } }
);

// ── Tool-definities ───────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wettenbank_zoek",
      description:
        "Zoek Nederlandse regelingen op naam en retourneer BWB-id + metadata. " +
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
      description:
        "Haal de inhoudsopgave op van een Nederlandse wet: hoofdstukken, afdelingen, " +
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
      description:
        "Haal één artikel op uit een Nederlandse wet in schone Markdown. " +
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
      description:
        "Zoek welke artikelen een begrip bevatten in één Nederlandse wet. " +
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
            description:
              "Te zoeken begrip. Wildcards: termijn* of *termijn*. " +
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
            description:
              "Voeg de artikeltekst toe aan elk resultaat. " +
              "Bespaart een extra wettenbank_artikel-aanroep.",
          },
        },
      },
    },
  ],
}));

// ── Tool-handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let text: string;
    if (name === "wettenbank_zoek") {
      text = await handleZoek(args);
    } else if (name === "wettenbank_structuur") {
      text = await handleStructuur(args);
    } else if (name === "wettenbank_artikel") {
      text = await handleArtikel(args);
    } else if (name === "wettenbank_zoekterm") {
      text = await handleZoekterm(args);
    } else {
      return {
        content: [{ type: "text", text: `Onbekende tool: ${name}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ fout: (err as Error).message }) },
      ],
      isError: true,
    };
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────
// server en transport worden geëxporteerd zodat index.ts de startup kan afhandelen.

export { server };
export { StdioServerTransport };
