import { describe, expect, it } from "vitest";
import { buildStartRequest, projectSchema } from "./projectForm";

describe("projectSchema", () => {
  it("eist een niet-leeg artikel", () => {
    const leeg = projectSchema.safeParse({ artikel: "", review: true });
    expect(leeg.success).toBe(false);
    const spaties = projectSchema.safeParse({ artikel: "   ", review: true });
    expect(spaties.success).toBe(false); // trim → leeg
  });

  it("trimt waarden en accepteert een geldig artikel", () => {
    const r = projectSchema.safeParse({ artikel: "  9  ", review: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.artikel).toBe("9");
  });

  it("weigert te lange velden", () => {
    expect(projectSchema.safeParse({ artikel: "1", review: true, bwbId: "x".repeat(65) }).success).toBe(false);
    expect(projectSchema.safeParse({ artikel: "x".repeat(33), review: true }).success).toBe(false);
  });
});

describe("buildStartRequest", () => {
  it("laat lege optionele velden weg, behoudt artikel + review", () => {
    const body = buildStartRequest({ artikel: "9", review: true });
    expect(body).toEqual({ artikel: "9", review: true });
    expect("bwbId" in body).toBe(false);
    expect("model_profile" in body).toBe(false);
  });

  it("neemt ingevulde optionele velden mee", () => {
    const body = buildStartRequest({
      artikel: "9",
      review: false,
      bwbId: "BWBR0004770",
      lid: "2",
      naam: "Erfrecht",
      omschrijving: "context",
      analysefocus: "vraag",
      model_profile: "azure-sonnet",
    });
    expect(body).toEqual({
      artikel: "9",
      review: false,
      bwbId: "BWBR0004770",
      lid: "2",
      naam: "Erfrecht",
      omschrijving: "context",
      analysefocus: "vraag",
      model_profile: "azure-sonnet",
    });
  });
});
