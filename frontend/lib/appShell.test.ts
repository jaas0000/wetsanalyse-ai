import { describe, expect, it } from "vitest";

import { isAppShellPad } from "./appShell";

describe("isAppShellPad", () => {
  it("geldt voor de werkplek", () => {
    expect(isAppShellPad("/workbench")).toBe(true);
  });

  // De instellingen openen als dialog over de werkplek: de URL wijzigt naar /instellingen/… terwijl
  // de werkplek eronder blijft staan. Zonder deze regel dook de globale logobalk boven de dialog op
  // en verloor de werkplek zijn volle hoogte.
  it("geldt voor de instellingen en hun tabs", () => {
    expect(isAppShellPad("/instellingen/account")).toBe(true);
    expect(isAppShellPad("/instellingen/beheer/gebruikers")).toBe(true);
  });

  it("geldt niet voor de losse pagina's buiten de app-shell", () => {
    for (const p of ["/login", "/setup", "/disclaimer", "/"]) {
      expect(isAppShellPad(p)).toBe(false);
    }
  });
});

// De footer moet dezelfde regel volgen als de header: hij dook eerder op achter de
// instellingen-dialog, omdat die de URL verandert terwijl de werkplek eronder blijft staan.
describe("app-shell: alle chrome volgt dezelfde regel", () => {
  it("geldt voor header, main én footer op de instellingen", () => {
    expect(isAppShellPad("/instellingen")).toBe(true);
    expect(isAppShellPad("/instellingen/beheer/api-tokens")).toBe(true);
  });
});
