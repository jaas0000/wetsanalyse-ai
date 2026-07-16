import { describe, it, expect, vi, afterEach } from "vitest";
import { trace } from "@opentelemetry/api";
import { log, veiligeToolVelden } from "./logger.js";

function vangStderr(fn: () => void): string[] {
  const regels: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    regels.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return regels;
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
  delete process.env.LOG_ZOEKTERMEN;
});

describe("logger — log", () => {
  it("schrijft één JSON-regel met UTC-timestamp en kernvelden", () => {
    const regels = vangStderr(() => log("info", "audit", "test", { tool: "x" }));
    expect(regels).toHaveLength(1);
    const obj = JSON.parse(regels[0]);
    expect(obj.niveau).toBe("info");
    expect(obj.categorie).toBe("audit");
    expect(obj.bericht).toBe("test");
    expect(obj.tool).toBe("x");
    expect(obj.ts).toMatch(/Z$/); // ISO-8601 UTC
  });

  it("respecteert LOG_LEVEL (debug onder de drempel wordt onderdrukt)", () => {
    process.env.LOG_LEVEL = "warn";
    const regels = vangStderr(() => log("info", "functioneel", "stil"));
    expect(regels).toHaveLength(0);
  });

  it("redacteert geheime velden (token/authorization) defensief", () => {
    const regels = vangStderr(() =>
      log("info", "security", "x", { authorization: "Bearer geheim", token: "abc", ip: "1.2.3.4" })
    );
    const obj = JSON.parse(regels[0]);
    expect(obj.authorization).toBeUndefined();
    expect(obj.token).toBeUndefined();
    expect(obj.ip).toBe("1.2.3.4");
    expect(regels[0]).not.toContain("geheim");
  });

  it("voegt geen trace-velden toe zonder actieve span", () => {
    const obj = JSON.parse(vangStderr(() => log("info", "functioneel", "x"))[0]);
    expect(obj.trace_id).toBeUndefined();
    expect(obj.span_id).toBeUndefined();
  });

  it("injecteert trace_id/span_id van de actieve span", () => {
    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi
      .spyOn(trace, "getActiveSpan")
      .mockReturnValue({ spanContext: () => spanContext } as any);
    try {
      const obj = JSON.parse(vangStderr(() => log("info", "functioneel", "x"))[0]);
      expect(obj.trace_id).toBe(spanContext.traceId);
      expect(obj.span_id).toBe(spanContext.spanId);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("logger — veiligeToolVelden", () => {
  it("behoudt traceerbare velden", () => {
    const v = veiligeToolVelden({ bwbId: "BWBR0004770", artikel: "9", lid: "1" });
    expect(v).toEqual({ bwbId: "BWBR0004770", artikel: "9", lid: "1" });
  });

  it("redacteert de zoekterm standaard tot lengte", () => {
    const v = veiligeToolVelden({ zoekterm: "geheime term" });
    expect(v.zoekterm).toBe("[geredacteerd]");
    expect(v.zoekterm_lengte).toBe("geheime term".length);
  });

  it("logt de volledige zoekterm alleen met LOG_ZOEKTERMEN=1", () => {
    process.env.LOG_ZOEKTERMEN = "1";
    const v = veiligeToolVelden({ zoekterm: "open" });
    expect(v.zoekterm).toBe("open");
  });

  it("is robuust tegen niet-objecten", () => {
    expect(veiligeToolVelden(null)).toEqual({});
    expect(veiligeToolVelden("x")).toEqual({});
  });
});
