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
 * Beveiliging (BIO2 / ISO 27002:2022):
 *   - 8.5  Per-client bearer-tokens (auth.ts), constant-tijd vergeleken.
 *   - 8.6  Rate limiting per IP (rate-limit.ts) tegen DoS/brute-force.
 *   - 8.15/8.16 Gestructureerde logging van auth-, security- en verkeers-events.
 *   - Securityheaders + 1 MB body-cap + idle-sessie-opruiming.
 * /health blijft altijd vrij toegankelijk.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { authenticeer, type ClientToken } from "./auth.js";
import { maakRateLimiter, leesRateConfig, type RateLimiter } from "./rate-limit.js";
import { maakOidcVerifier, oidcConfigUitEnv, type OidcVerifier } from "./oidc.js";
import { buildInfo } from "./build-info.js";
import { log } from "./logger.js";

const MAX_BODY_BYTES = 1_000_000;

// Sessies zonder activiteit worden na dit interval opgeruimd. Een client die wegvalt
// zonder DELETE laat zijn transport anders permanent in het geheugen achter.
const SESSION_IDLE_MS = Number(process.env.MCP_SESSION_IDLE_MS ?? 30 * 60 * 1000);

/** Securityheaders op elke respons (defence-in-depth; geen info-lekkage). */
function zetSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

// Aantal vertrouwde proxy-hops dat zelf een X-Forwarded-For-waarde toevoegt (bv. Nginx
// Proxy Manager = 1). De echte client is de hop díe onze vertrouwde proxy toevoegde, dus
// de N-de waarde van rechts — niet de eerste van links (die kan de client zelf spoofen).
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.MCP_TRUSTED_PROXY_HOPS ?? 1));

/**
 * Kies het client-IP uit een X-Forwarded-For-waarde. Neemt de waarde op positie
 * `lengte - hops` (van rechts geteld), zodat een door de client zelf meegestuurde XFF de
 * rate-limit-key en het audit-IP niet kan vervalsen. Valt terug op `socketIp` als XFF
 * ontbreekt of te kort is voor het aantal vertrouwde hops. Pure functie (testbaar).
 */
export function kiesClientIp(
  xff: string | string[] | undefined,
  socketIp: string | undefined,
  hops = TRUSTED_PROXY_HOPS
): string {
  const ruw = Array.isArray(xff) ? xff.join(",") : xff;
  if (typeof ruw === "string" && ruw.length > 0) {
    const lijst = ruw.split(",").map((h) => h.trim()).filter(Boolean);
    const idx = lijst.length - hops;
    if (idx >= 0 && lijst[idx]) return lijst[idx];
  }
  return socketIp ?? "onbekend";
}

/** Client-IP achter de proxy; zie {@link kiesClientIp}. */
function clientIp(req: IncomingMessage): string {
  return kiesClientIp(req.headers["x-forwarded-for"], req.socket.remoteAddress);
}

/** Lees en JSON-parse de request-body; undefined bij een lege body. */
function leesBody(req: IncomingMessage): Promise<unknown> {
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
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Schrijf een JSON-RPC-foutantwoord met de gegeven HTTP-status. */
function stuurFout(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    })
  );
}

export interface HttpServerOpties {
  port: number;
  /** Per-client tokens; indien niet leeg is /mcp afgeschermd. */
  clients?: ClientToken[];
  /** Legacy: één gedeelde token (wordt vertaald naar clientId "default"). */
  token?: string;
  /** Optionele rate-limiter; default leest config uit de omgeving. */
  rateLimiter?: RateLimiter;
  /** Optionele OIDC-verifier; default leest config uit de omgeving (null = uit). */
  oidc?: OidcVerifier | null;
}

/**
 * Start de Streamable-HTTP-server. Retourneert de http.Server zodat aanroepers
 * (en tests) op 'listening' kunnen wachten en hem netjes kunnen sluiten.
 */
export function startHttpServer(opts: HttpServerOpties): HttpServer {
  // Auth-config: nieuwe per-client lijst + legacy enkelvoud samengevoegd.
  const clients: ClientToken[] = [...(opts.clients ?? [])];
  if (opts.token && !clients.some((c) => c.id === "default")) {
    clients.push({ id: "default", token: opts.token });
  }
  // OIDC: expliciet meegegeven, anders uit de omgeving (null als OIDC_ISSUER ontbreekt).
  const oidc = opts.oidc !== undefined ? opts.oidc : maakOidcVerifier(oidcConfigUitEnv());
  const authVereist = clients.length > 0 || oidc !== null;

  const rateLimiter = opts.rateLimiter ?? maakRateLimiter(leesRateConfig());

  // Eén transport per sessie; gekoppeld aan een verse Server-instantie.
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  // Laatste activiteit per sessie, voor idle-opruiming.
  const lastSeen: Record<string, number> = {};

  // Periodiek verlaten sessies sluiten (clients die zonder DELETE wegvallen).
  const cleanup = setInterval(() => {
    const nu = Date.now();
    for (const sid of Object.keys(transports)) {
      if (nu - (lastSeen[sid] ?? 0) > SESSION_IDLE_MS) {
        try {
          transports[sid].close();
        } catch {
          /* close kan al gebeurd zijn */
        }
        delete transports[sid];
        delete lastSeen[sid];
        log("info", "functioneel", "sessie opgeruimd (idle)", { sessionId: sid });
      }
    }
  }, Math.min(SESSION_IDLE_MS, 5 * 60 * 1000));
  cleanup.unref();

  const httpServer = createHttpServer(async (req, res) => {
    const requestId = randomUUID();
    const ip = clientIp(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    zetSecurityHeaders(res);

    // Healthcheck — altijd vrij toegankelijk, geen logging (ruis van Portainer/Azure).
    // Geeft naast de status ook build-info terug (version/commit/builtAt), zodat
    // deploy-pariteit met één request controleerbaar is. Geen secrets — alleen herkomst.
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", ...buildInfo }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    // Rate limiting per IP — beschermt ook het auth-pad tegen brute-force.
    if (!rateLimiter.staToe(ip)) {
      log("warn", "security", "rate limit overschreden", { requestId, ip, pad: url.pathname });
      res.setHeader("Retry-After", "1");
      stuurFout(res, 429, "Te veel verzoeken");
      return;
    }

    // Auth: per-client bearer-token (statisch, snel), met OIDC-JWT als fallback.
    // clientId belandt in de auditlog.
    let clientId: string | undefined;
    if (authVereist) {
      const authHeader = req.headers["authorization"] as string | undefined;
      let result = authenticeer(authHeader, clients);
      if (!result && oidc) {
        result = await oidc.verifieer(authHeader);
      }
      if (!result) {
        log("warn", "security", "authenticatie geweigerd", {
          requestId,
          ip,
          reden: authHeader ? "onjuiste token" : "ontbrekende token",
        });
        stuurFout(res, 401, "Ongeautoriseerd: ontbrekende of onjuiste bearer-token");
        return;
      }
      clientId = result;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    // Alleen verversen voor een bekende sessie. Anders kan een client met een willekeurige
    // mcp-session-id ongebonden lastSeen-entries laten groeien: de idle-cleanup itereert over
    // `transports` en ruimt zulke verweesde entries nooit op. De init-tak zet lastSeen zelf
    // in `onsessioninitialized`.
    if (sessionId && transports[sessionId]) lastSeen[sessionId] = Date.now();

    const start = Date.now();
    try {
      if (req.method === "POST") {
        const body = await leesBody(req);
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Bestaande sessie.
          transport = transports[sessionId];
        } else if (isInitializeRequest(body)) {
          // Nieuwe sessie: ook accepteren als client een verlopen sessie-ID meestuurt
          // (bv. na server-restart). De verouderde ID wordt genegeerd; de nieuwe sessie
          // krijgt een eigen ID via sessionIdGenerator.
          if (sessionId) {
            log("info", "functioneel", "verlopen sessie-ID genegeerd bij herinitialisatie", {
              requestId,
              verlopen_sessionId: sessionId,
              clientId,
              ip,
            });
          }
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports[sid] = transport;
              lastSeen[sid] = Date.now();
              log("info", "functioneel", "sessie geïnitialiseerd", {
                requestId,
                sessionId: sid,
                clientId,
                ip,
              });
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
              delete lastSeen[transport.sessionId];
              log("info", "functioneel", "sessie gesloten", { sessionId: transport.sessionId });
            }
          };
          // clientId vast, sessionId laat-gebonden via closure.
          await createServer({
            clientId,
            getSessionId: () => transport.sessionId,
          }).connect(transport);
        } else if (sessionId) {
          // Sessie-ID opgegeven maar niet (meer) bekend — per MCP-spec HTTP 404.
          stuurFout(res, 404, "Not Found: sessie niet gevonden of verlopen");
          return;
        } else {
          stuurFout(res, 400, "Bad Request: geen geldige sessie-ID");
          return;
        }

        await transport.handleRequest(req, res, body);
        log("info", "functioneel", "request afgehandeld", {
          requestId,
          methode: "POST",
          clientId,
          sessionId: sessionId ?? transport.sessionId,
          ip,
          duur_ms: Date.now() - start,
        });
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
    } catch (err) {
      log("error", "functioneel", "verwerkingsfout", {
        requestId,
        ip,
        clientId,
        fout: (err as Error).message,
      });
      if (!res.headersSent) {
        // Geen interne details (upstream-status, timeout-teksten) naar de client lekken;
        // het volledige detail staat in de log-regel hierboven.
        stuurFout(res, 400, "Verwerkingsfout bij het afhandelen van het verzoek");
      }
    }
  });

  httpServer.on("close", () => {
    clearInterval(cleanup);
    rateLimiter.stop();
  });

  httpServer.listen(opts.port, "0.0.0.0", () => {
    log("info", "functioneel", "HTTP-server gestart", {
      poort: opts.port,
      auth: authVereist
        ? `tokens=${clients.length}${oidc ? " + oidc" : ""}`
        : "geen",
    });
  });

  return httpServer;
}
