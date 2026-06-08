import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { startHttpServer } from "./http-server.js";

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

describe("http-server", () => {
  it("/health geeft 200 zonder auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
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
});
