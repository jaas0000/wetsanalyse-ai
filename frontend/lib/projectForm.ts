// Pure validatie- en body-bouwlogica voor het analyseformulier, los van de React-component
// zodat ze direct te unit-testen is. De UI (components/ProjectForm.tsx) gebruikt deze helpers.

import { z } from "zod";
import type { BronInput, StartRequest } from "./types";

// Eén bron-rij in het werkgebied (wet + artikel + lid).
export const bronSchema = z.object({
  bwbId: z.string().trim().max(64).optional(),
  artikel: z.string().trim().min(1, "Artikel is verplicht").max(32),
  lid: z.string().trim().max(16).optional(),
});

export type BronFormValue = z.infer<typeof bronSchema>;

export const projectSchema = z.object({
  bronnen: z.array(bronSchema).min(1, "Voeg minstens één bron toe"),
  naam: z.string().trim().max(200).optional(),
  omschrijving: z.string().trim().max(2000).optional(),
  analysefocus: z.string().trim().max(2000).optional(),
  review: z.boolean(),
  model_profile: z.string().trim().max(64).optional(),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;

/** Eén lege bron-rij voor het formulier. */
export function legeBron(): BronFormValue {
  return { bwbId: "", artikel: "", lid: "" };
}

/** Bouw de API-body: laat lege optionele velden weg zodat de API z'n defaults gebruikt. */
export function buildStartRequest(d: ProjectFormValues): StartRequest {
  const bronnen: BronInput[] = d.bronnen.map((b) => {
    const out: BronInput = { artikel: b.artikel };
    if (b.bwbId) out.bwbId = b.bwbId;
    if (b.lid) out.lid = b.lid;
    return out;
  });
  const body: StartRequest = { bronnen, review: d.review };
  if (d.naam) body.naam = d.naam;
  if (d.omschrijving) body.omschrijving = d.omschrijving;
  if (d.analysefocus) body.analysefocus = d.analysefocus;
  if (d.model_profile) body.model_profile = d.model_profile;
  return body;
}
