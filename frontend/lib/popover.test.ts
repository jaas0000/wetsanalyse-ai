import { describe, expect, it } from "vitest";

import { plaatsPopover } from "./popover";

const POPOVER = { breedte: 320, hoogte: 280 };
const SCHERM = { breedte: 400, hoogte: 800 };

describe("plaatsPopover", () => {
  it("hangt onder de selectie als het daar past", () => {
    const p = plaatsPopover({ midden: 200, boven: 100, onder: 120 }, POPOVER, SCHERM);
    expect(p).toEqual({ left: 40, top: 128, boven: false });
  });

  it("klapt naar boven als het er onder niet meer past", () => {
    // Selectie onderin een telefoonscherm: onder de selectie is nog 100 px, de popover is 280 hoog.
    // Dit was de bug — de klasse-lijst viel buiten beeld en `position: fixed` scrolt niet mee.
    const p = plaatsPopover({ midden: 200, boven: 660, onder: 700 }, POPOVER, SCHERM);
    expect(p.boven).toBe(true);
    expect(p.top).toBe(660 - 280 - 8);
    expect(p.top + POPOVER.hoogte).toBeLessThan(660);
  });

  it("valt terug op de bovenrand als het nergens past", () => {
    const laag = { breedte: 400, hoogte: 320 };
    const p = plaatsPopover({ midden: 200, boven: 150, onder: 200 }, POPOVER, laag);
    expect(p.top).toBe(8);
    expect(p.top + POPOVER.hoogte).toBeLessThanOrEqual(laag.hoogte);
  });

  it("houdt de popover binnen de linker- en rechterrand", () => {
    expect(plaatsPopover({ midden: 5, boven: 100, onder: 120 }, POPOVER, SCHERM).left).toBe(8);
    expect(plaatsPopover({ midden: 395, boven: 100, onder: 120 }, POPOVER, SCHERM).left).toBe(
      400 - 320 - 8,
    );
  });

  it("centreert op de selectie als daar ruimte voor is", () => {
    const breed = { breedte: 1400, hoogte: 900 };
    expect(plaatsPopover({ midden: 700, boven: 300, onder: 320 }, POPOVER, breed).left).toBe(540);
  });
});
