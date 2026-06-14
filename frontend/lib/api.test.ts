import { describe, expect, it } from "vitest";
import { isApiError, parseError } from "./api";

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
