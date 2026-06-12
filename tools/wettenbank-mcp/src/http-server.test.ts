import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import {
  startHttpServer,
  kiesClientIp,
  hostZonderPoort,
  leesAllowedHosts,
} from "./http-server.js";
import { maakRateLimiter } from "./rate-limit.js";

const TOKEN = "test-token-123";

let httpServer: HttpServer;
let baseUrl: string;

beforeAll(async () => {
  httpServer = startHttpServer({ port: 0, token: TOKEN });
  await new Promise<void>((resolve) => httpServer.once("listening", () => resolve()));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("kiesClientIp (X-Forwarded-For)", () => {
  it("neemt bij 1 vertrouwde hop het IP dat de proxy toevoegde (rechtse waarde)", () => {
    // Client spooft "1.1.1.1"; de proxy voegt het echte IP "9.9.9.9" rechts toe.
    expect(kiesClientIp("1.1.1.1, 9.9.9.9", "10.0.0.1", 1)).toBe("9.9.9.9");
  });

  it("kiest de juiste hop bij meerdere vertrouwde proxies", () => {
    expect(kiesClientIp("1.1.1.1, echt, proxyA", "10.0.0.1", 2)).toBe("echt");
  });

  it("valt terug op de socket als XFF ontbreekt", () => {
    expect(kiesClientIp(undefined, "10.0.0.1", 1)).toBe("10.0.0.1");
  });

  it("valt terug op de socket als XFF te kort is voor het aantal hops", () => {
    expect(kiesClientIp("1.1.1.1", "10.0.0.1", 2)).toBe("10.0.0.1");
  });

  it("geeft 'onbekend' als noch XFF noch socket bekend is", () => {
    expect(kiesClientIp(undefined, undefined, 1)).toBe("onbekend");
  });
});

describe("http-server", () => {
  it("/health geeft 200 zonder auth, maar zónder build-info (geen publieke SHA)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "ok" });
  });

  it("/health geeft build-info wél met een geldige token", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof body.version).toBe("string");
    expect(body.version).not.toBe("");
    // Geen GIT_SHA in de testomgeving → fallback "dev".
    expect(body.commit).toBe("dev");
    expect(body.builtAt).toBeNull();
  });

  it("/mcp zonder bearer-token geeft 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("/mcp met onjuiste token geeft 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer fout" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("POST /mcp zonder sessie en zonder initialize geeft 400", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /mcp met verlopen sessie-ID en zonder initialize geeft 404", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "mcp-session-id": "verlopen-sessie-id-12345",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  it("herhaalde onbekende sessie-ID's blijven 404 geven (geen verweesde lastSeen-entries)", async () => {
    // Regressie: lastSeen werd vroeger gezet vóór de transports-check, zodat een client met
    // willekeurige mcp-session-id's ongebonden entries kon laten groeien die de cleanup-lus
    // (itereert over transports) nooit opruimt. Het pad hoort onveranderd 404 te geven.
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "mcp-session-id": `onbekend-${i}-${Math.random()}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(404);
    }
  });

  it("POST /mcp met verlopen sessie-ID en initialize start nieuwe sessie", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "verlopen-sessie-id-67890",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const nieuweSessieId = res.headers.get("mcp-session-id");
    expect(nieuweSessieId).toBeTruthy();
    expect(nieuweSessieId).not.toBe("verlopen-sessie-id-67890");
  });

  it("GET /mcp zonder sessie geeft 400", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(400);
  });

  it("onbekend pad geeft 404", async () => {
    const res = await fetch(`${baseUrl}/onbekend`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("zet securityheaders op /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("http-server — per-client tokens", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    server = startHttpServer({
      port: 0,
      clients: [
        { id: "alice", token: "tok-a" },
        { id: "bob", token: "tok-b" },
      ],
    });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("accepteert een geldige client-token (geen 401)", async () => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer tok-b", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).not.toBe(401);
  });

  it("weigert een onbekende token met 401", async () => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer onbekend" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});

describe("http-server — OIDC-only auth", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    // Stub-verifier: accepteert uitsluitend 'Bearer good' → clientId 'alice'.
    const oidc = {
      verifieer: async (h?: string) => (h === "Bearer good" ? "alice" : null),
    };
    server = startHttpServer({ port: 0, clients: [], oidc });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("weigert zonder token (401) ook al zijn er geen statische clients", async () => {
    const res = await fetch(`${url}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("accepteert een geldig OIDC-token (geen 401)", async () => {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer good", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).not.toBe(401);
  });
});

describe("http-server — idle-cleanup ontziet actieve SSE-streams", () => {
  let server: HttpServer;
  let url: string;
  const IDLE = 120; // ms — cleanup tikt elke min(IDLE, 5min) = 120ms

  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function initSession(): Promise<string> {
    const res = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: initBody,
    });
    const sid = res.headers.get("mcp-session-id");
    if (!sid) throw new Error("geen sessie-ID na initialize");
    return sid;
  }

  function postToolsList(sid: string) {
    return fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sid,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
  }

  beforeAll(async () => {
    server = startHttpServer({ port: 0, token: TOKEN, sessionIdleMs: IDLE });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("reapt een sessie zónder open stream na de idle-timeout (controle)", async () => {
    const sid = await initSession();
    await sleep(IDLE * 4); // ruim voorbij idle + meerdere cleanup-ticks
    const res = await postToolsList(sid);
    expect(res.status).toBe(404); // sessie is opgeruimd
  });

  it("ontziet een sessie met een open GET-SSE-stream", async () => {
    const sid = await initSession();
    const ac = new AbortController();
    const sse = await fetch(`${url}/mcp`, {
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": sid, accept: "text/event-stream" },
      signal: ac.signal,
    });
    expect(sse.status).toBe(200);
    try {
      await sleep(IDLE * 4); // zonder de fix zou de sessie nu gereapt zijn
      const res = await postToolsList(sid);
      expect(res.status).not.toBe(404); // sessie leeft nog dankzij de actieve stream
    } finally {
      ac.abort();
      await sse.body?.cancel().catch(() => {});
    }
  });
});

describe("http-server — rate limiting", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    // Krappe limiter: 2 requests, daarna 429.
    server = startHttpServer({
      port: 0,
      token: "t",
      rateLimiter: maakRateLimiter({ capaciteit: 2, perSeconde: 0 }),
    });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("geeft 429 zodra de emmer leeg is", async () => {
    const statussen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${url}/mcp`, { method: "POST", body: "{}" });
      statussen.push(res.status);
    }
    expect(statussen[2]).toBe(429); // derde request over de limiet
  });
});

// ── Nieuwe security-gedragingen ───────────────────────────────────────────────

async function initSessie(url: string, token: string): Promise<string | null> {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
  });
  const sid = res.headers.get("mcp-session-id");
  await res.body?.cancel().catch(() => {});
  return sid;
}

describe("http-server — sessie gebonden aan client", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    server = startHttpServer({
      port: 0,
      clients: [
        { id: "client-a", token: "tok-a" },
        { id: "client-b", token: "tok-b" },
      ],
    });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("weigert een sessie-ID van een andere client (404, als onbekend)", async () => {
    const sid = await initSessie(url, "tok-a");
    expect(sid).toBeTruthy();

    const alsB = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer tok-b",
        "content-type": "application/json",
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(alsB.status).toBe(404);

    // De rechtmatige eigenaar kan de sessie wél blijven gebruiken.
    const alsA = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer tok-a",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(alsA.status).not.toBe(404);
    await alsA.body?.cancel().catch(() => {});
  });
});

describe("http-server — Host-validatie (DNS-rebinding)", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    server = startHttpServer({
      port: 0,
      token: TOKEN,
      allowedHosts: ["127.0.0.1"],
    });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("accepteert de geconfigureerde host en weigert een vreemde Host-header", async () => {
    const goed = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(goed.status).not.toBe(403);

    // fetch (undici) staat geen handmatige Host-header toe; gebruik node:http.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const r = request(
        `${url}/mcp`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            host: "rebind.aanvaller.example",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      r.on("error", reject);
      r.end("{}");
    });
    expect(status).toBe(403);
  });

  it("hostZonderPoort strips poort en IPv6-blokhaken", () => {
    expect(hostZonderPoort("example.nl:3000")).toBe("example.nl");
    expect(hostZonderPoort("example.nl")).toBe("example.nl");
    expect(hostZonderPoort("[::1]:3000")).toBe("::1");
    expect(hostZonderPoort(undefined)).toBe("");
  });

  it("leesAllowedHosts parseert en normaliseert MCP_ALLOWED_HOSTS", () => {
    expect(
      leesAllowedHosts({ MCP_ALLOWED_HOSTS: "Wettenbank-MCP.ipalm.nl, intern " } as NodeJS.ProcessEnv)
    ).toEqual(["wettenbank-mcp.ipalm.nl", "intern"]);
    expect(leesAllowedHosts({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("http-server — per-client rate limiting", () => {
  let server: HttpServer;
  let url: string;

  beforeAll(async () => {
    server = startHttpServer({
      port: 0,
      token: "t",
      rateLimiter: maakRateLimiter({ capaciteit: 100, perSeconde: 0 }),
      clientRateLimiter: maakRateLimiter({ capaciteit: 2, perSeconde: 0 }),
    });
    await new Promise<void>((r) => server.once("listening", () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("begrenst per geauthenticeerde clientId, los van het IP", async () => {
    const doe = () =>
      fetch(`${url}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: "{}",
      });
    expect((await doe()).status).not.toBe(429);
    expect((await doe()).status).not.toBe(429);
    expect((await doe()).status).toBe(429);
  });
});

describe("http-server — fail-closed zonder auth", () => {
  it("weigert te starten zonder tokens/OIDC tenzij allowNoAuth", async () => {
    expect(() => startHttpServer({ port: 0 })).toThrow(/geen enkele authenticatie/);

    const open = startHttpServer({ port: 0, allowNoAuth: true });
    await new Promise<void>((r) => open.once("listening", () => r()));
    await new Promise<void>((r) => open.close(() => r()));
  });
});

describe("http-server — body-cap in bytes", () => {
  it("weigert een multibyte-payload die in karakters onder maar in bytes boven de cap zit", async () => {
    // 550.000 × 'é' = 550k karakters maar ~1,1 MB UTF-8: een karakter-telling zou dit
    // doorlaten, de byte-telling hoort te weigeren.
    const body = `"${"é".repeat(550_000)}"`;
    let status = 0;
    try {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body,
      });
      status = res.status;
    } catch {
      // req.destroy() kan de verbinding verbreken vóór de 400 geschreven is.
      status = -1;
    }
    expect(status).not.toBe(200);
    expect([400, -1]).toContain(status);
  });
});
