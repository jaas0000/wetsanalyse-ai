#!/usr/bin/env node
/**
 * HTTP-transport voor de Wettenbank MCP-server (Streamable HTTP).
 *
 * Draait de server als langlevende netwerkservice i.p.v. een per-sessie subproces.
 * Bedoeld voor een gecontaineriseerde deployment (Portainer/Azure) die meerdere
 * clients/machines kunnen delen. De stdio-modus (zie index.ts) blijft de default.
 *
 * Endpoints:
 *   POST   /mcp     — JSON-RPC requests (initialize start een sessie)
 *   GET    /mcp     — SSE-stream voor server→client notificaties (per sessie)
 *   DELETE /mcp     — sessie sluiten
 *   GET    /health  — healthcheck (200, geen auth) voor Portainer/Azure
 *
 * Auth: als MCP_AUTH_TOKEN is gezet, eist /mcp een `Authorization: Bearer <token>`.
 * /health blijft altijd vrij toegankelijk.
 */
import { createServer as createHttpServer, } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
const MAX_BODY_BYTES = 1_000_000;
/** Lees en JSON-parse de request-body; undefined bij een lege body. */
function leesBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > MAX_BODY_BYTES) {
                reject(new Error("request-body te groot"));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!data)
                return resolve(undefined);
            try {
                resolve(JSON.parse(data));
            }
            catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}
/** Schrijf een JSON-RPC-foutantwoord met de gegeven HTTP-status. */
function stuurFout(res, status, message) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message },
        id: null,
    }));
}
/**
 * Start de Streamable-HTTP-server. Retourneert de http.Server zodat aanroepers
 * (en tests) op 'listening' kunnen wachten en hem netjes kunnen sluiten.
 */
export function startHttpServer(opts) {
    // Eén transport per sessie; gekoppeld aan een verse Server-instantie.
    const transports = {};
    const httpServer = createHttpServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        // Healthcheck — altijd vrij toegankelijk.
        if (req.method === "GET" && url.pathname === "/health") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
        }
        if (url.pathname !== "/mcp") {
            res.writeHead(404).end();
            return;
        }
        // Auth: alleen afdwingen als er een token is geconfigureerd.
        if (opts.token && req.headers["authorization"] !== `Bearer ${opts.token}`) {
            stuurFout(res, 401, "Ongeautoriseerd: ontbrekende of onjuiste bearer-token");
            return;
        }
        const sessionId = req.headers["mcp-session-id"];
        try {
            if (req.method === "POST") {
                const body = await leesBody(req);
                let transport;
                if (sessionId && transports[sessionId]) {
                    // Bestaande sessie.
                    transport = transports[sessionId];
                }
                else if (!sessionId && isInitializeRequest(body)) {
                    // Nieuwe sessie: maak transport + verse Server-instantie.
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid) => {
                            transports[sid] = transport;
                        },
                    });
                    transport.onclose = () => {
                        if (transport.sessionId)
                            delete transports[transport.sessionId];
                    };
                    await createServer().connect(transport);
                }
                else {
                    stuurFout(res, 400, "Bad Request: geen geldige sessie-ID");
                    return;
                }
                await transport.handleRequest(req, res, body);
                return;
            }
            if (req.method === "GET" || req.method === "DELETE") {
                // SSE-stream of sessie-afsluiting: vereist een bestaande sessie.
                if (!sessionId || !transports[sessionId]) {
                    stuurFout(res, 400, "Bad Request: ontbrekende of onbekende sessie-ID");
                    return;
                }
                await transports[sessionId].handleRequest(req, res);
                return;
            }
            res.writeHead(405).end();
        }
        catch (err) {
            if (!res.headersSent) {
                stuurFout(res, 400, `Verwerkingsfout: ${err.message}`);
            }
        }
    });
    httpServer.listen(opts.port, "0.0.0.0", () => {
        const auth = opts.token ? "met bearer-token" : "zonder auth";
        // Naar stderr: stdout blijft zo schoon voor eventueel parallel stdio-gebruik.
        console.error(`Wettenbank MCP (HTTP) luistert op 0.0.0.0:${opts.port}/mcp (${auth})`);
    });
    return httpServer;
}
