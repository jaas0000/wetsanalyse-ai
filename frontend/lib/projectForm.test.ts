import { describe, expect, it } from "vitest";
import { buildStartRequest, projectSchema } from "./projectForm";

describe("projectSchema", () => {
  it("eist minstens één bron met een niet-leeg artikel", () => {
    const geen = projectSchema.safeParse({ bronnen: [], review: true });
    expect(geen.success).toBe(false);
    const leeg = projectSchema.safeParse({ bronnen: [{ artikel: "" }], review: true });
    expect(leeg.success).toBe(false);
    const spaties = projectSchema.safeParse({ bronnen: [{ artikel: "   " }], review: true });
    expect(spaties.success).toBe(false); // trim → leeg
  });

  it("trimt waarden en accepteert een geldig artikel", () => {
    const r = projectSchema.safeParse({ bronnen: [{ artikel: "  9  " }], review: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bronnen[0].artikel).toBe("9");
  });

  it("weigert te lange velden", () => {
    expect(
      projectSchema.safeParse({ bronnen: [{ artikel: "1", bwbId: "x".repeat(65) }], review: true }).success,
    ).toBe(false);
    expect(projectSchema.safeParse({ bronnen: [{ artikel: "x".repeat(33) }], review: true }).success).toBe(false);
  });
});

describe("buildStartRequest", () => {
  it("laat lege optionele velden weg, behoudt bronnen + review", () => {
    const body = buildStartRequest({ bronnen: [{ artikel: "9" }], review: true });
    expect(body).toEqual({ bronnen: [{ artikel: "9" }], review: true });
    expect("naam" in body).toBe(false);
    expect("model_profile" in body).toBe(false);
  });

  it("neemt meerdere bronnen en optionele velden mee", () => {
    const body = buildStartRequest({
      bronnen: [
        { artikel: "43", bwbId: "BWBR0018450", lid: "2" },
        { artikel: "5.6", bwbId: "BWBR0018715" },
      ],
      review: false,
      naam: "Iab Zvw",
      omschrijving: "context",
      analysefocus: "vraag",
      model_profile: "azure-sonnet",
    });
    expect(body).toEqual({
      bronnen: [
        { artikel: "43", bwbId: "BWBR0018450", lid: "2" },
        { artikel: "5.6", bwbId: "BWBR0018715" },
      ],
      review: false,
      naam: "Iab Zvw",
      omschrijving: "context",
      analysefocus: "vraag",
      model_profile: "azure-sonnet",
    });
  });
});
