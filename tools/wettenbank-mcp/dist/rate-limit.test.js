import { describe, it, expect, vi, afterEach } from "vitest";
import { maakRateLimiter, leesRateConfig } from "./rate-limit.js";
afterEach(() => {
    vi.useRealTimers();
});
describe("rate-limit — token-bucket", () => {
    it("staat een burst tot de capaciteit toe en weigert daarna", () => {
        const rl = maakRateLimiter({ capaciteit: 3, perSeconde: 0 });
        expect(rl.staToe("ip1")).toBe(true);
        expect(rl.staToe("ip1")).toBe(true);
        expect(rl.staToe("ip1")).toBe(true);
        expect(rl.staToe("ip1")).toBe(false);
        rl.stop();
    });
    it("scheidt emmers per sleutel", () => {
        const rl = maakRateLimiter({ capaciteit: 1, perSeconde: 0 });
        expect(rl.staToe("ip1")).toBe(true);
        expect(rl.staToe("ip1")).toBe(false);
        expect(rl.staToe("ip2")).toBe(true); // andere IP, eigen emmer
        rl.stop();
    });
    it("vult na verloop van tijd weer aan", () => {
        vi.useFakeTimers();
        const rl = maakRateLimiter({ capaciteit: 1, perSeconde: 1 });
        expect(rl.staToe("ip1")).toBe(true);
        expect(rl.staToe("ip1")).toBe(false);
        vi.advanceTimersByTime(1000); // +1 token
        expect(rl.staToe("ip1")).toBe(true);
        rl.stop();
    });
    it("telt actieve emmers via omvang()", () => {
        const rl = maakRateLimiter({ capaciteit: 5, perSeconde: 0 });
        rl.staToe("a");
        rl.staToe("b");
        expect(rl.omvang()).toBe(2);
        rl.stop();
    });
});
describe("rate-limit — leesRateConfig", () => {
    it("gebruikt defaults bij ontbrekende env", () => {
        const cfg = leesRateConfig({});
        expect(cfg.capaciteit).toBe(60);
        expect(cfg.perSeconde).toBeCloseTo(2);
    });
    it("leest burst en per-minuut uit env", () => {
        const cfg = leesRateConfig({ MCP_RATE_BURST: "10", MCP_RATE_PER_MIN: "60" });
        expect(cfg.capaciteit).toBe(10);
        expect(cfg.perSeconde).toBeCloseTo(1);
    });
});
