import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startHttpServer } from "./http-server.js";
import { maakRateLimiter } from "./rate-limit.js";
const TOKEN = "test-token-123";
let httpServer;
let baseUrl;
beforeAll(async () => {
    httpServer = startHttpServer({ port: 0, token: TOKEN });
    await new Promise((resolve) => httpServer.once("listening", () => resolve()));
    const { port } = httpServer.address();
    baseUrl = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
    await new Promise((resolve) => httpServer.close(() => resolve()));
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
    it("zet securityheaders op /health", async () => {
        const res = await fetch(`${baseUrl}/health`);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
});
describe("http-server — per-client tokens", () => {
    let server;
    let url;
    beforeAll(async () => {
        server = startHttpServer({
            port: 0,
            clients: [
                { id: "alice", token: "tok-a" },
                { id: "bob", token: "tok-b" },
            ],
        });
        await new Promise((r) => server.once("listening", () => r()));
        url = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(async () => {
        await new Promise((r) => server.close(() => r()));
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
describe("http-server — rate limiting", () => {
    let server;
    let url;
    beforeAll(async () => {
        // Krappe limiter: 2 requests, daarna 429.
        server = startHttpServer({
            port: 0,
            token: "t",
            rateLimiter: maakRateLimiter({ capaciteit: 2, perSeconde: 0 }),
        });
        await new Promise((r) => server.once("listening", () => r()));
        url = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(async () => {
        await new Promise((r) => server.close(() => r()));
    });
    it("geeft 429 zodra de emmer leeg is", async () => {
        const statussen = [];
        for (let i = 0; i < 3; i++) {
            const res = await fetch(`${url}/mcp`, { method: "POST", body: "{}" });
            statussen.push(res.status);
        }
        expect(statussen[2]).toBe(429); // derde request over de limiet
    });
});
