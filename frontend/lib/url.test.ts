import { describe, expect, it } from "vitest";
import { pathSegment } from "./url";

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
