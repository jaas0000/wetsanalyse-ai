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
import {
  maakRateLimiter,
  leesRateConfig,
  leesClientRateConfig,
  normaliseerIpSleutel,
  type RateLimiter,
} from "./rate-limit.js";
import { maakOidcVerifier, oidcConfigUitEnv, type OidcVerifier } from "./oidc.js";
import { buildInfo } from "./build-info.js";
import { log } from "./logger.js";
import { upstreamStatus } from "./clients/sru-client.js";

const MAX_BODY_BYTES = 1_000_000;

// Readiness: bereikbaarheid van de upstream-bronnen, kort gecachet zodat /ready geen
// upstream-storm veroorzaakt. /health blijft pure liveness (los hiervan).
const READY_CACHE_MS = 15_000;
let readyCache: { ts: number; sru: boolean; repository: boolean } | undefined;

async function leesReadiness(): Promise<{ sru: boolean; repository: boolean }> {
  if (readyCache && Date.now() - readyCache.ts < READY_CACHE_MS) {
    return { sru: readyCache.sru, repository: readyCache.repository };
  }
  const status = await upstreamStatus();
  readyCache = { ts: Date.now(), ...status };
  return status;
}

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

/** Hostnaam uit de Host-header, zonder poort (incl. IPv6 met blokhaken). */
export function hostZonderPoort(host: string | undefined): string {
  if (!host) return "";
  if (host.startsWith("[")) {
    const eind = host.indexOf("]");
    return eind > 0 ? host.slice(1, eind) : host;
  }
  return host.split(":")[0];
}

/** Toegestane hosts (DNS-rebinding-bescherming) uit MCP_ALLOWED_HOSTS; leeg = check uit. */
export function leesAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Lees en JSON-parse de request-body; undefined bij een lege body.
 * De cap telt bytes (Buffer-lengte), niet string-karakters: bij multibyte-payloads
 * zou een karakter-telling tot ~4× zoveel werkelijke bytes binnenlaten, en decoderen
 * per chunk kan een multibyte-teken op een chunk-grens corrumperen. Daarom pas op
 * `end` concateneren en decoderen.
 */
function leesBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("request-body te groot"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (bytes === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
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
  /** Optionele rate-limiter (per IP); default leest config uit de omgeving. */
  rateLimiter?: RateLimiter;
  /** Optionele tweede limiter per geauthenticeerde clientId; default uit de omgeving. */
  clientRateLimiter?: RateLimiter;
  /** Optionele OIDC-verifier; default leest config uit de omgeving (null = uit). */
  oidc?: OidcVerifier | null;
  /** Idle-timeout per sessie in ms; default uit MCP_SESSION_IDLE_MS (30 min). */
  sessionIdleMs?: number;
  /** Toegestane Host-headers (DNS-rebinding-bescherming); default MCP_ALLOWED_HOSTS. */
  allowedHosts?: string[];
  /**
   * Sta expliciet toe om zónder enige auth te starten (tests, afgeschermd netwerk).
   * Zonder deze vlag is startHttpServer zelf fail-closed — de check in index.ts
   * (MCP_ALLOW_NO_AUTH) is dan niet langer de enige verdedigingslinie.
   */
  allowNoAuth?: boolean;
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
  if (!authVereist && !opts.allowNoAuth) {
    throw new Error(
      "startHttpServer: geen enkele authenticatie geconfigureerd (tokens noch OIDC). " +
        "Geef expliciet allowNoAuth: true mee om bewust zonder auth te draaien."
    );
  }

  const rateLimiter = opts.rateLimiter ?? maakRateLimiter(leesRateConfig());
  const clientRateLimiter = opts.clientRateLimiter ?? maakRateLimiter(leesClientRateConfig());
  const allowedHosts = opts.allowedHosts ?? leesAllowedHosts();
  const sessionIdleMs = opts.sessionIdleMs ?? SESSION_IDLE_MS;

  // Eén transport per sessie; gekoppeld aan een verse Server-instantie.
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  // Eigenaar (clientId) per sessie: een sessie is alleen bruikbaar met het token
  // waarmee hij is geïnitialiseerd. Anders kan client B met een gelekt sessie-ID de
  // sessie van client A overnemen én verschijnen B's acties als A in de auditlog.
  const sessieClient: Record<string, string | undefined> = {};
  // Laatste activiteit per sessie, voor idle-opruiming.
  const lastSeen: Record<string, number> = {};
  // Aantal in-flight requests per sessie. Een langlevende SSE-stream (de standalone
  // GET-stream, of een streaming respons) houdt `handleRequest` open en ververst `lastSeen`
  // dus níét. transport.close() (SDK 1.29.0) sluit echter álle SSE-streams hard en vuurt
  // onclose — een idle-reap zou een actieve stream dus midden in de verbinding afbreken.
  // Daarom reapen we een sessie alleen als er geen request/stream meer open is.
  const actief: Record<string, number> = {};

  // Periodiek verlaten sessies sluiten (clients die zonder DELETE wegvallen).
  const cleanup = setInterval(() => {
    const nu = Date.now();
    for (const sid of Object.keys(transports)) {
      if (!actief[sid] && nu - (lastSeen[sid] ?? 0) > sessionIdleMs) {
        try {
          transports[sid].close();
        } catch {
          /* close kan al gebeurd zijn */
        }
        delete transports[sid];
        delete lastSeen[sid];
        delete actief[sid];
        delete sessieClient[sid];
        log("info", "functioneel", "sessie opgeruimd (idle)", { sessionId: sid });
      }
    }
  }, Math.min(sessionIdleMs, 5 * 60 * 1000));
  cleanup.unref();

  const httpServer = createHttpServer(async (req, res) => {
    const requestId = randomUUID();
    const ip = clientIp(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    zetSecurityHeaders(res);

    // Healthcheck — altijd vrij toegankelijk (Docker HEALTHCHECK), geen logging (ruis
    // van Portainer/Azure). Build-info (version/commit/builtAt) gaat alleen mee als het
    // request zich met een geldige statische token meldt of als auth uitstaat: een
    // volledige git-SHA op het publieke domein is fingerprint-informatie.
    if (req.method === "GET" && url.pathname === "/health") {
      const metBuild =
        !authVereist ||
        Boolean(authenticeer(req.headers["authorization"] as string | undefined, clients));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(metBuild ? { status: "ok", ...buildInfo } : { status: "ok" }));
      return;
    }

    // Rate limiting per IP — vóór alle overige endpoints (ook /ready: die triggert
    // upstream-checks) en vóór het auth-pad (brute-force). IPv6 wordt per /64 gebucket.
    if (!rateLimiter.staToe(normaliseerIpSleutel(ip))) {
      log("warn", "security", "rate limit overschreden", { requestId, ip, pad: url.pathname });
      res.setHeader("Retry-After", "1");
      stuurFout(res, 429, "Te veel verzoeken");
      return;
    }

    // Readiness — weerspiegelt of de upstream-bronnen bereikbaar zijn (503 bij niet-bereikbaar),
    // i.t.t. /health (liveness). Auth-vrij; alleen op debug gelogd.
    if (req.method === "GET" && url.pathname === "/ready") {
      const upstream = await leesReadiness();
      const ready = upstream.sru && upstream.repository;
      log("debug", "functioneel", "readiness-check", { ready, ...upstream });
      res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready, upstream }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    // DNS-rebinding-bescherming: alleen requests met een verwachte Host-header.
    // Auth dekt dit risico al grotendeels af (een browser kan geen Authorization-header
    // cross-origin meesturen), maar deze check sluit de klasse definitief uit.
    if (allowedHosts.length > 0) {
      const host = hostZonderPoort(req.headers.host).toLowerCase();
      if (!allowedHosts.includes(host)) {
        log("warn", "security", "host-header geweigerd", { requestId, ip, host });
        stuurFout(res, 403, "Forbidden: onbekende Host");
        return;
      }
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

      // Tweede limiter per afnemer: één client achter een gedeeld proxy-IP (of met
      // veel IP's) kan de bron anders alsnog overbelasten.
      if (!clientRateLimiter.staToe(clientId)) {
        log("warn", "security", "client-rate-limit overschreden", { requestId, ip, clientId });
        res.setHeader("Retry-After", "1");
        stuurFout(res, 429, "Te veel verzoeken voor deze client");
        return;
      }
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    // Sessie-eigenaarschap: een bekend sessie-ID telt alleen als "bestaande sessie" voor
    // de client die hem initialiseerde. Bij een andere clientId behandelen we het ID als
    // onbekend (zelfde 404 als een verlopen sessie — geen informatie-lek over bestaan).
    const sessieVanClient = Boolean(
      sessionId && transports[sessionId] && sessieClient[sessionId] === clientId
    );
    if (sessionId && transports[sessionId] && !sessieVanClient) {
      log("warn", "security", "sessie-ID van andere client geweigerd", {
        requestId,
        ip,
        clientId,
        sessionId,
      });
    }
    // Alleen verversen voor een bekende eigen sessie. Anders kan een client met een
    // willekeurige mcp-session-id ongebonden lastSeen-entries laten groeien: de idle-cleanup
    // itereert over `transports` en ruimt zulke verweesde entries nooit op. De init-tak zet
    // lastSeen zelf in `onsessioninitialized`.
    if (sessionId && sessieVanClient) lastSeen[sessionId] = Date.now();

    const start = Date.now();
    try {
      if (req.method === "POST") {
        const body = await leesBody(req);
        let transport: StreamableHTTPServerTransport;

        if (sessionId && sessieVanClient) {
          // Bestaande sessie van deze client.
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
              sessieClient[sid] = clientId;
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
              delete actief[transport.sessionId];
              delete sessieClient[transport.sessionId];
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
        // SSE-stream of sessie-afsluiting: vereist een bestaande, eigen sessie.
        if (!sessionId || !sessieVanClient) {
          stuurFout(res, 400, "Bad Request: ontbrekende of onbekende sessie-ID");
          return;
        }
        // Markeer de sessie als actief zolang het request (mogelijk een langlevende
        // SSE-stream) loopt, zodat de idle-cleanup hem niet midden in de stream reapt.
        actief[sessionId] = (actief[sessionId] ?? 0) + 1;
        try {
          await transports[sessionId].handleRequest(req, res);
        } finally {
          actief[sessionId] = (actief[sessionId] ?? 1) - 1;
          if (actief[sessionId] <= 0) delete actief[sessionId];
          // Verse idle-window na het sluiten van de stream (mits de sessie nog bestaat).
          if (transports[sessionId]) lastSeen[sessionId] = Date.now();
        }
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
    clientRateLimiter.stop();
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
