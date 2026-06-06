/**
 * Zod-schemas voor alle MCP tool inputs en outputs.
 * Dient als contractdefinitie; de gateway valideert hiertegen bij elke aanroep.
 */

import { z } from "zod";

function vandaag(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ZoekInputSchema = z
  .object({
    titel: z.string().optional(),
    rechtsgebied: z.string().optional(),
    ministerie: z.string().optional(),
    regelingsoort: z
      .enum(["wet", "AMvB", "ministeriele-regeling", "regeling", "besluit"])
      .optional(),
    maxResultaten: z.number().int().min(1).max(50).default(10),
    // .default(vandaag) — Zod v3 accepteert een factory-function; wordt lazy geëvalueerd per parse-call.
    // .default(vandaag()) zou fout zijn: evalueert eenmalig bij module-load en bevriest de datum.
    peildatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "peildatum moet YYYY-MM-DD zijn").default(vandaag),
  })
  .refine(
    (d) => d.titel || d.rechtsgebied || d.ministerie || d.regelingsoort,
    "Geef minimaal één zoekcriterium op (titel, rechtsgebied, ministerie of regelingsoort)."
  );

export const ZoektermInputSchema = z.object({
  bwbId: z.string().min(1, "bwbId mag niet leeg zijn"),
  zoekterm: z.string().min(1, "zoekterm mag niet leeg zijn"),
  peildatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "peildatum moet YYYY-MM-DD zijn").default(vandaag),
  maxResultaten: z.number().int().min(1).max(50).default(10),
  includeerTekst: z.boolean().default(false),
});

export const ArtikelInputSchema = z.object({
  bwbId: z.string().min(1, "bwbId mag niet leeg zijn"),
  artikel: z.string().min(1, "artikel mag niet leeg zijn"),
  lid: z.string().nullish(),
  peildatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "peildatum moet YYYY-MM-DD zijn").default(vandaag),
});

export const StructuurInputSchema = z.object({
  bwbId: z.string().min(1, "bwbId mag niet leeg zijn"),
  peildatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "peildatum moet YYYY-MM-DD zijn").default(vandaag),
});

// ── Output schemas ────────────────────────────────────────────────────────────

export const RegelingSchema = z.object({
  bwbId: z.string(),
  titel: z.string(),
  type: z.string(),
  ministerie: z.string(),
  rechtsgebied: z.string(),
  geldigVanaf: z.string(),
  geldigTot: z.string(),
  gewijzigd: z.string(),
  repositoryUrl: z.string(),
});

export const ZoekOutputSchema = z.object({
  formaat: z.literal("plain"),
  totaal: z.number(),
  regelingen: z.array(RegelingSchema),
});

export const ZoektermOutputSchema = z.object({
  formaat: z.literal("plain"),
  wet: z.string(),
  versiedatum: z.string(),
  bwbId: z.string(),
  zoekterm: z.string(),
  // null wanneer isVolledig=false (toekomstige streaming-implementatie);
  // bij DOM-parsing (volledige scan) is dit altijd een getal.
  totaalTreffers: z.number().nullable(),
  // true = volledige scan uitgevoerd; false = afgebroken na maxResultaten (nog niet geïmplementeerd voor DOM)
  isVolledig: z.boolean(),
  aantalArtikelen: z.number(),
  artikelen: z.array(
    z.object({
      artikel: z.string(),
      aantalTreffers: z.number(),
      leden: z.array(z.string()),
      tekst: z.string().optional(),       // alleen bij includeerTekst=true
      formaat: z.enum(["plain", "markdown"]).optional(),
    })
  ),
});

export const ArtikelOutputSchema = z.object({
  formaat: z.enum(["plain", "markdown"]),
  citeertitel: z.string(),
  versiedatum: z.string(),
  bwbId: z.string(),
  artikel: z.string(),
  lid: z.string().optional(),
  sectie: z.string().optional(),
  pad: z.string().optional(),             // bijv. "Hoofdstuk 2 > Afdeling 2.1 > Artikel 5"
  leden: z.array(z.object({ lid: z.string(), tekst: z.string() })),
  bronreferentie: z.string(),
  waarschuwing: z.string().nullable().optional(),
});

// Recursief schema voor de wet-structuur
const _StructuurNodeBase = z.object({
  type: z.string(),
  nr: z.string(),
  titel: z.string().optional(),
  artikelen: z.array(z.string()).optional(),
});
type _StructuurNodeRec = z.infer<typeof _StructuurNodeBase> & {
  secties?: _StructuurNodeRec[];
};
export const StructuurNodeSchema: z.ZodType<_StructuurNodeRec> = _StructuurNodeBase.extend({
  secties: z.lazy(() => z.array(StructuurNodeSchema)).optional(),
});

export const StructuurOutputSchema = z.object({
  formaat: z.literal("plain"),
  bwbId: z.string(),
  citeertitel: z.string(),
  versiedatum: z.string(),
  structuur: z.array(StructuurNodeSchema),
});

// Foutformat — behouden voor backwards-compatibiliteit met bestaande consumers
export const FoutOutputSchema = z.object({
  fout: z.string(),
});

// Inferred TypeScript-typen
export type ZoekInput = z.infer<typeof ZoekInputSchema>;
export type ZoektermInput = z.infer<typeof ZoektermInputSchema>;
export type ArtikelInput = z.infer<typeof ArtikelInputSchema>;
export type StructuurInput = z.infer<typeof StructuurInputSchema>;
export type ZoekOutput = z.infer<typeof ZoekOutputSchema>;
export type ZoektermOutput = z.infer<typeof ZoektermOutputSchema>;
export type ArtikelOutput = z.infer<typeof ArtikelOutputSchema>;
export type StructuurOutput = z.infer<typeof StructuurOutputSchema>;
export type StructuurNode = z.infer<typeof StructuurNodeSchema>;
