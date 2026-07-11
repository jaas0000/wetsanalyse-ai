// Tests voor de authorized-callback: de CSRF Origin-check (defense-in-depth naast
// SameSite=Lax) op muterende BFF-routes, zonder de rol-/sessie-gates te breken.

import { describe, expect, it } from "vitest";
import { authConfig } from "./auth.config";

type AuthorizedFn = (params: { auth: unknown; request: unknown }) => unknown;
const authorized = authConfig.callbacks.authorized as unknown as AuthorizedFn;

function fakeRequest(method: string, url: string, headers: Record<string, string> = {}) {
  return { method, nextUrl: new URL(url), headers: new Headers(headers) };
}

const sessie = { user: { userid: "an1", role: "analist" } };

describe("Origin-check op muterende BFF-routes", () => {
  it("weigert een POST met een vreemde Origin (403)", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("POST", "https://app.example/api/projects", {
        origin: "https://evil.example",
      }),
    });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("laat een POST met de eigen Origin door", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("POST", "https://app.example/api/projects", {
        origin: "https://app.example",
      }),
    });
    expect(res).toBe(true);
  });

  it("accepteert de x-forwarded-host achter de proxy", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("POST", "http://intern:3000/api/projects", {
        origin: "https://app.example",
        "x-forwarded-host": "app.example",
      }),
    });
    expect(res).toBe(true);
  });

  it("weigert een onparseerbare Origin (403)", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("POST", "https://app.example/api/projects", {
        origin: "geen-geldige-url",
      }),
    });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("valt zonder Origin-header terug op SameSite (geen 403)", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("POST", "https://app.example/api/projects"),
    });
    expect(res).toBe(true);
  });

  it("laat GET met vreemde Origin ongemoeid (alleen muterende methodes)", async () => {
    const res = await authorized({
      auth: sessie,
      request: fakeRequest("GET", "https://app.example/api/projects", {
        origin: "https://evil.example",
      }),
    });
    expect(res).toBe(true);
  });

  it("geldt óók op publieke routes zoals /api/login-verify", async () => {
    const res = await authorized({
      auth: null,
      request: fakeRequest("POST", "https://app.example/api/login-verify", {
        origin: "https://evil.example",
      }),
    });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("blijft zonder sessie gewoon weigeren (rol-/sessie-gate intact)", async () => {
    const res = await authorized({
      auth: null,
      request: fakeRequest("POST", "https://app.example/api/projects", {
        origin: "https://app.example",
      }),
    });
    expect(res).toBe(false);
  });
});
