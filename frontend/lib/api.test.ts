import { afterEach, describe, expect, it, vi } from "vitest";
import { annoteerStream, isApiError, parseError } from "./api";

describe("parseError", () => {
  it("haalt een string-detail uit de JSON-body", async () => {
    const res = new Response(JSON.stringify({ detail: "Onbekend project" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const err = await parseError(res);
    expect(err).toMatchObject({ status: 404, detail: "Onbekend project" });
    expect(err.retryAfter).toBeUndefined();
  });

  it("stringificeert een niet-string detail (bv. validatiefouten)", async () => {
    const res = new Response(JSON.stringify({ detail: [{ msg: "te lang" }] }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
    const err = await parseError(res);
    expect(err.status).toBe(422);
    expect(err.detail).toContain("te lang");
  });

  it("valt terug op statusText zonder JSON-body", async () => {
    const res = new Response("kapot", { status: 502, statusText: "Bad Gateway" });
    const err = await parseError(res);
    expect(err.status).toBe(502);
    expect(err.detail).toBe("Bad Gateway");
  });

  it("leest de Retry-After-header als getal", async () => {
    const res = new Response(JSON.stringify({ detail: "te druk" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "12" },
    });
    const err = await parseError(res);
    expect(err.retryAfter).toBe(12);
  });
});

function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("annoteerStream", () => {
  afterEach(() => vi.restoreAllMocks());

  // Regressie: graph-qa's EventSourceResponse (sse-starlette) scheidt frames met \r\n\r\n. De parser
  // moet die grens vinden — anders blijft de stream onverwerkt en levert de workbench 0 elementen.
  it("verwerkt met \\r\\n\\r\\n gescheiden frames (sse-starlette)", async () => {
    const element = { klasse: "Rechtssubject", tekst: "de werkgever" };
    const frames = [
      `data: ${JSON.stringify({ type: "status", message: "bezig" })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "element", element })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "done", aantal: 1, verworpen: 0 })}\r\n\r\n`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));

    const elementen: unknown[] = [];
    const status: string[] = [];
    const res = await annoteerStream("BWBR0004770", "9", {
      onStatus: (m) => status.push(m),
      onElement: (el) => elementen.push(el),
    });

    expect(elementen).toEqual([element]);
    expect(status).toEqual(["bezig"]);
    expect(res).toEqual({ aantal: 1, verworpen: 0 });
  });
});

describe("isApiError", () => {
  it("herkent een ApiError-vorm", () => {
    expect(isApiError({ status: 404, detail: "x" })).toBe(true);
  });
  it("wijst andere waarden af", () => {
    expect(isApiError(new Error("boom"))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("tekst")).toBe(false);
  });
});
