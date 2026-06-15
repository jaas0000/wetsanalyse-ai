import { describe, expect, it } from "vitest";
import { bronHref, pathSegment, wettenOverheidHref } from "./url";

describe("pathSegment", () => {
  it("encodeert een kale slug met gereserveerde tekens precies één keer", () => {
    // Artikel 4:86 → slug met ':' → moet %3A worden, niet %253A.
    expect(pathSegment("bwbr0005537-art4:86-3")).toBe("bwbr0005537-art4%3A86-3");
  });

  it("dubbel-encodeert een al-geëncodeerde param niet (Next levert params ge-encode aan)", () => {
    expect(pathSegment("bwbr0005537-art4%3A86-3")).toBe("bwbr0005537-art4%3A86-3");
  });

  it("is idempotent: tweemaal toepassen geeft hetzelfde resultaat", () => {
    const once = pathSegment("bwbr0005537-art4:86-3");
    expect(pathSegment(once)).toBe(once);
  });

  it("laat een gewone slug zonder gereserveerde tekens ongemoeid", () => {
    expect(pathSegment("bwbr0004770-art9-lid2")).toBe("bwbr0004770-art9-lid2");
  });

  it("codeert spaties (bv. een profielnaam) correct", () => {
    expect(pathSegment("Mijn Profiel")).toBe("Mijn%20Profiel");
    expect(pathSegment("Mijn%20Profiel")).toBe("Mijn%20Profiel");
  });
});

describe("bronHref", () => {
  it("maakt van een jci-uri een wetten.overheid.nl-deeplink", () => {
    expect(bronHref("jci1.3:c:BWBR0004770&artikel=9")).toBe(
      "https://wetten.overheid.nl/jci1.3:c:BWBR0004770&artikel=9",
    );
  });

  it("laat een complete http(s)-URL ongemoeid", () => {
    expect(bronHref("https://wetten.overheid.nl/BWBR0004770")).toBe(
      "https://wetten.overheid.nl/BWBR0004770",
    );
  });

  it("weigert een javascript:-URL (XSS) → undefined", () => {
    expect(bronHref("javascript:alert(document.cookie)")).toBeUndefined();
    expect(bronHref("JavaScript:alert(1)")).toBeUndefined();
  });

  it("weigert een data:-URL en lege invoer → undefined", () => {
    expect(bronHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(bronHref("")).toBeUndefined();
    expect(bronHref(undefined)).toBeUndefined();
  });
});

describe("wettenOverheidHref", () => {
  it("bouwt een pad onder wetten.overheid.nl", () => {
    expect(wettenOverheidHref("jci1.3:c:BWBR0004770&artikel=9")).toBe(
      "https://wetten.overheid.nl/jci1.3:c:BWBR0004770&artikel=9",
    );
  });

  it("laat de host niet ontsnappen via een vreemde target", () => {
    // encodeURI codeert geen backslash/at; de URL-parse moet host wetten.overheid.nl houden.
    const href = wettenOverheidHref("@evil.example/pad");
    expect(href === undefined || new URL(href).hostname === "wetten.overheid.nl").toBe(true);
  });

  it("geeft undefined bij lege invoer", () => {
    expect(wettenOverheidHref("")).toBeUndefined();
    expect(wettenOverheidHref(null)).toBeUndefined();
  });
});
