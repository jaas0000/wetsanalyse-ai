import { describe, expect, it } from "vitest";

import { bronHash, lidUitOffset, maakAnker, offsetUit, snapSelectie } from "./selectie";

const BRON = "De ontvanger kan uitstel verlenen. Dat mag hij weigeren.";

describe("offsetUit", () => {
  it("telt de lengtes van de voorgaande tekstknopen op", () => {
    // De browser geeft (knoop, offset-daarbinnen); wij rekenen naar één offset in de hele bron.
    expect(offsetUit([10, 20, 5], 0, 3)).toBe(3);
    expect(offsetUit([10, 20, 5], 1, 4)).toBe(14);
    expect(offsetUit([10, 20, 5], 2, 0)).toBe(30);
  });

  it("blijft binnen de perken bij een knoopindex voorbij de lijst", () => {
    expect(offsetUit([10], 5, 2)).toBe(12);
  });
});

describe("snapSelectie", () => {
  it("haalt meegesleepte spaties en leestekens van de randen", () => {
    // Een muisselectie pakt bijna altijd te veel mee; het fragment moet letterlijk terugvindbaar zijn.
    const ruw = BRON.indexOf(" kan uitstel verlenen.");
    const { start, eind } = snapSelectie(BRON, ruw, ruw + " kan uitstel verlenen.".length);
    expect(BRON.slice(start, eind)).toBe("kan uitstel verlenen");
  });

  it("draait een omgekeerde selectie om (van rechts naar links slepen)", () => {
    const { start, eind } = snapSelectie(BRON, 12, 3);
    expect(start).toBeLessThan(eind);
    expect(BRON.slice(start, eind)).toBe("ontvanger");
  });

  it("geeft een leeg bereik als er alleen witruimte is geselecteerd", () => {
    const spatie = BRON.indexOf(" ");
    const { start, eind } = snapSelectie(BRON, spatie, spatie + 1);
    expect(start).toBe(eind);
  });

  it("klemt buiten de tekst vallende posities af", () => {
    const { start, eind } = snapSelectie(BRON, -5, BRON.length + 99);
    expect(start).toBe(0);
    expect(eind).toBe(BRON.length - 1); // de slotpunt gaat eraf
  });
});

describe("maakAnker", () => {
  it("legt positie, context en een vingerafdruk van de bron vast", () => {
    const start = BRON.indexOf("uitstel");
    const anker = maakAnker(BRON, start, start + 7, "1");
    expect(BRON.slice(anker.start, anker.eind)).toBe("uitstel");
    expect(anker.voor.endsWith("kan ")).toBe(true);
    expect(anker.na.startsWith(" verlenen")).toBe(true);
    expect(anker.bron_hash).toBe(bronHash(BRON));
    expect(anker.lid).toBe("1");
  });
});

describe("bronHash", () => {
  it("verschilt zodra de tekst verandert — dat is het hele punt", () => {
    expect(bronHash(BRON)).toBe(bronHash(BRON));
    expect(bronHash(BRON)).not.toBe(bronHash(BRON + " "));
  });
});

describe("lidUitOffset", () => {
  const leden = ["Eerste lid tekst.", "Tweede lid tekst.", "Derde lid."];

  it("wijst een offset toe aan het juiste lid", () => {
    // De bron is leden.join("\n\n"), dus tussen elk lid zitten twee tekens.
    expect(lidUitOffset(leden, 0)).toBe("1");
    expect(lidUitOffset(leden, 16)).toBe("1");
    expect(lidUitOffset(leden, 19)).toBe("2");
    expect(lidUitOffset(leden, 38)).toBe("3");
  });

  it("geeft leeg terug voorbij het laatste lid", () => {
    expect(lidUitOffset(leden, 9999)).toBe("");
  });
});
