import { describe, it, expect, vi, afterEach } from "vitest";
import {
  maakRateLimiter,
  leesRateConfig,
  leesClientRateConfig,
  normaliseerIpSleutel,
} from "./rate-limit.js";

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
    const cfg = leesRateConfig({} as NodeJS.ProcessEnv);
    expect(cfg.capaciteit).toBe(60);
    expect(cfg.perSeconde).toBeCloseTo(2);
  });

  it("leest burst en per-minuut uit env", () => {
    const cfg = leesRateConfig({ MCP_RATE_BURST: "10", MCP_RATE_PER_MIN: "60" } as NodeJS.ProcessEnv);
    expect(cfg.capaciteit).toBe(10);
    expect(cfg.perSeconde).toBeCloseTo(1);
  });
});

describe("normaliseerIpSleutel", () => {
  it("laat IPv4 en IPv4-mapped IPv6 per adres", () => {
    expect(normaliseerIpSleutel("203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseerIpSleutel("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("bucket IPv6 op de /64-prefix, ongeacht notatievariant", () => {
    expect(normaliseerIpSleutel("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(normaliseerIpSleutel("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:1:2::/64"
    );
    expect(normaliseerIpSleutel("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    // Twee adressen uit hetzelfde /64 delen dus één emmer.
    expect(normaliseerIpSleutel("2001:db8:1:2::aa")).toBe(
      normaliseerIpSleutel("2001:db8:1:2:ff::1")
    );
  });

  it("laat niet-IP-sleutels (bv. 'onbekend') ongemoeid", () => {
    expect(normaliseerIpSleutel("onbekend")).toBe("onbekend");
  });
});

describe("maxEmmers-plafond", () => {
  it("evict de langst-ongebruikte emmer boven het plafond i.p.v. onbegrensd te groeien", () => {
    vi.useFakeTimers();
    try {
      const limiter = maakRateLimiter({ capaciteit: 1, perSeconde: 0, maxEmmers: 3 });
      // Drie sleutels vullen het plafond; hun emmers zijn nu leeg (capaciteit 1, verbruikt).
      expect(limiter.staToe("a")).toBe(true);
      vi.advanceTimersByTime(10);
      expect(limiter.staToe("b")).toBe(true);
      vi.advanceTimersByTime(10);
      expect(limiter.staToe("c")).toBe(true);
      vi.advanceTimersByTime(10);
      // Vierde sleutel verdringt de oudste ("a") — en "a" begint daarna weer vers.
      expect(limiter.staToe("d")).toBe(true);
      expect(limiter.staToe("a")).toBe(true); // vers, dus weer 1 token
      limiter.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("leesClientRateConfig", () => {
  it("heeft ruimere defaults dan de per-IP-limiter en leest env-overrides", () => {
    const def = leesClientRateConfig({} as NodeJS.ProcessEnv);
    expect(def.capaciteit).toBe(120);
    expect(def.perSeconde).toBeCloseTo(300 / 60);
    const eigen = leesClientRateConfig({
      MCP_RATE_CLIENT_BURST: "10",
      MCP_RATE_CLIENT_PER_MIN: "60",
    } as NodeJS.ProcessEnv);
    expect(eigen.capaciteit).toBe(10);
    expect(eigen.perSeconde).toBe(1);
  });
});
