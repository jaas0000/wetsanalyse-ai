import { describe, it, expect } from "vitest";
import {
  UpstreamError,
  foutDetails,
  classificeer,
  extractCode,
  logNiveauVoor,
  metDeadline,
} from "./shared/fouten.js";

describe("classificeer", () => {
  it("5xx is transient, 4xx permanent", () => {
    expect(classificeer(undefined, 504)).toBe("transient");
    expect(classificeer(undefined, 502)).toBe("transient");
    expect(classificeer(undefined, 404)).toBe("permanent");
    expect(classificeer(undefined, 403)).toBe("permanent");
  });
  it("TLS-codes zijn permanent, netwerk-codes transient", () => {
    expect(classificeer("UNABLE_TO_VERIFY_LEAF_SIGNATURE", undefined)).toBe("permanent");
    expect(classificeer("CERT_HAS_EXPIRED", undefined)).toBe("permanent");
    expect(classificeer("ETIMEDOUT", undefined)).toBe("transient");
    expect(classificeer("ECONNREFUSED", undefined)).toBe("transient");
  });
  it("onbekende code/zonder status is onbekend", () => {
    expect(classificeer(undefined, undefined)).toBe("onbekend");
    expect(classificeer("IETS_RAARS", undefined)).toBe("onbekend");
  });
});

describe("extractCode", () => {
  it("loopt de cause-keten af (undici verpakt de echte fout)", () => {
    const echte = Object.assign(new Error("self signed"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    const fetchFailed = new Error("fetch failed", { cause: echte });
    expect(extractCode(fetchFailed)).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });
  it("geeft undefined zonder code", () => {
    expect(extractCode(new Error("zomaar"))).toBeUndefined();
  });
});

describe("UpstreamError", () => {
  it("leidt code en klasse af uit de cause", () => {
    const tls = Object.assign(new Error("cert"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
    const e = new UpstreamError("fetch failed", { bron: "Wetstekst-repository", cause: tls });
    expect(e.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(e.klasse).toBe("permanent");
    expect(e.bron).toBe("Wetstekst-repository");
    expect(e.message).toBe("fetch failed"); // backward-compat: message ongewijzigd
  });
  it("klasse uit httpStatus", () => {
    const e = new UpstreamError("SRU HTTP 504", { bron: "SRU", httpStatus: 504 });
    expect(e.klasse).toBe("transient");
  });
});

describe("foutDetails", () => {
  it("haalt host (geen query) uit de url, niet de volledige url", () => {
    const e = new UpstreamError("SRU HTTP 502", {
      bron: "SRU",
      url: "https://zoekservice.overheid.nl/sru/Search?query=geheim",
      httpStatus: 502,
    });
    const d = foutDetails(e);
    expect(d.host).toBe("zoekservice.overheid.nl");
    expect(d.bron).toBe("SRU");
    expect(d.httpStatus).toBe(502);
    expect(JSON.stringify(d)).not.toContain("geheim"); // geen query-lek
  });
  it("classificeert een Zod-achtige fout als client", () => {
    const zod = Object.assign(new Error("invalid"), { name: "ZodError" });
    expect(foutDetails(zod).klasse).toBe("client");
  });
  it("permanent → error, rest → warn", () => {
    expect(logNiveauVoor("permanent")).toBe("error");
    expect(logNiveauVoor("transient")).toBe("warn");
    expect(logNiveauVoor("client")).toBe("warn");
    expect(logNiveauVoor("onbekend")).toBe("warn");
  });
});

describe("metDeadline", () => {
  it("lost op binnen de deadline", async () => {
    await expect(metDeadline(Promise.resolve("ok"), 1000, "test")).resolves.toBe("ok");
  });
  it("gooit een transiënte tool-timeout bij overschrijding", async () => {
    const traag = new Promise<string>((r) => setTimeout(() => r("laat"), 50));
    await expect(metDeadline(traag, 5, "wettenbank_zoekterm")).rejects.toMatchObject({
      klasse: "transient",
      code: "TOOL_TIMEOUT",
    });
  });
});
