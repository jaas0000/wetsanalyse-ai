import { describe, expect, it } from "vitest";
import { onthoudRun, standVanVorigeRun, vergeetRun } from "./lopendeRun";

describe("standVanVorigeRun", () => {
  it("zegt niets als er geen beurt openstond", () => {
    expect(standVanVorigeRun(undefined, [])).toBe("geen");
  });

  it("herkent een beurt die gewoon is afgerond terwijl je weg was", () => {
    // Die verdwijnt óók uit het run-register (na de bewaartermijn), maar heeft wél een bericht
    // achtergelaten. Zonder dit onderscheid zou elke normale afloop als "afgebroken" gemeld worden.
    expect(standVanVorigeRun("run-1", ["run-0", "run-1"])).toBe("afgerond");
  });

  it("herkent een beurt die verdwenen is door een herstart", () => {
    // Geen run meer én geen bericht: het register is leeg. Dat hoort gezegd te worden, in plaats
    // van een gesprek dat halverwege ophoudt zonder uitleg.
    expect(standVanVorigeRun("run-1", ["run-0"])).toBe("verdwenen");
    expect(standVanVorigeRun("run-1", [])).toBe("verdwenen");
  });
});

describe("onthoudRun / vergeetRun", () => {
  it("houdt hoogstens één lopende beurt per gesprek bij", () => {
    let runs = onthoudRun({}, "g1", "run-1");
    runs = onthoudRun(runs, "g1", "run-2");
    expect(runs).toEqual({ g1: "run-2" });
  });

  it("houdt gesprekken uit elkaar", () => {
    const runs = onthoudRun(onthoudRun({}, "g1", "run-1"), "g2", "run-2");
    expect(vergeetRun(runs, "g1")).toEqual({ g2: "run-2" });
  });

  it("vergeten van iets dat er niet staat is geen fout", () => {
    expect(vergeetRun({ g1: "run-1" }, "g9")).toEqual({ g1: "run-1" });
  });
});
