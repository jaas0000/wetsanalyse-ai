import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { startHttpServer, kiesClientIp } from "./http-server.js";
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
  it("/health geeft 200 zonder auth, met build-info", async () => {
    const res = await fetch(`${baseUrl}/health`);
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
