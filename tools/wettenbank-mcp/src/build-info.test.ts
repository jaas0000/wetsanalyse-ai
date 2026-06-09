import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// build-info leest de env-vars bij import; vi.resetModules() + dynamic import laat
// ons beide paden testen (geïnjecteerd vs. fallback) met een verse module-instantie.
describe("build-info", () => {
  const oorspronkelijk = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...oorspronkelijk };
  });

  it("valt terug op 'dev'/null zonder env-vars", async () => {
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
    const { buildInfo } = await import("./build-info.js");
    expect(buildInfo.commit).toBe("dev");
    expect(buildInfo.builtAt).toBeNull();
    expect(typeof buildInfo.version).toBe("string");
    expect(buildInfo.version).not.toBe("");
  });

  it("neemt GIT_SHA en BUILD_TIME over als ze gezet zijn", async () => {
    process.env.GIT_SHA = "abc123";
    process.env.BUILD_TIME = "2026-06-09T12:00:00Z";
    const { buildInfo } = await import("./build-info.js");
    expect(buildInfo.commit).toBe("abc123");
    expect(buildInfo.builtAt).toBe("2026-06-09T12:00:00Z");
  });
});
