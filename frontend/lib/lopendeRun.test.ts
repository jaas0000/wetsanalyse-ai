import { describe, expect, it } from "vitest";
import { naEenGebrokenStream, onthoudRun, standVanVorigeRun, vergeetRun } from "./lopendeRun";

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

describe("naEenGebrokenStream", () => {
  it("negeert een stream die we zelf afbraken", () => {
    // Unmount of van gesprek wisselen: de run draait door, er valt niets te melden of te herstellen.
    expect(naEenGebrokenStream(true, 0, 1, true)).toBe("negeren");
  });

  it("haakt opnieuw aan als de verbinding wegvalt", () => {
    // Dit is het geval dat bij een deploy optrad: de frontend-container werd vervangen, het tabblad
    // zag "network error", en de beurt liep ondertussen door en slaagde.
    expect(naEenGebrokenStream(false, 0, 1, true)).toBe("opnieuw");
  });

  it("meldt pas als de herkansing op is", () => {
    // Eén poging, niet meer: is de dienst echt weg, dan is doorproberen een molen die de gebruiker
    // niets vertelt.
    expect(naEenGebrokenStream(false, 1, 1, true)).toBe("melden");
  });

  it("probeert niet opnieuw als het venster weg is", () => {
    // Zonder venster is er niemand om het antwoord aan te tonen; de run draait gewoon door.
    expect(naEenGebrokenStream(false, 0, 1, false)).toBe("melden");
  });
});
