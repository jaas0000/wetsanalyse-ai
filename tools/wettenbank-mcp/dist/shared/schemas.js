/**
 * Zod-schemas voor alle MCP tool inputs en outputs.
 * Dient als contractdefinitie; de gateway valideert hiertegen bij elke aanroep.
 */
import { z } from "zod";
import { vandaag } from "./utils.js";
/** Controleert of een YYYY-MM-DD-string een bestaande kalenderdatum is (bv. niet 2024-13-45). */
function isEchteKalenderdatum(s) {
    const [j, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(j, m - 1, d));
    return (dt.getUTCFullYear() === j &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d);
}
// Herbruikbaar peildatum-schema: vorm én geldigheid valideren, met default = vandaag.
// .default(vandaag) — factory-functie, lazy geëvalueerd per parse-call. .default(vandaag())
// zou de datum eenmalig bij module-load bevriezen en is dus fout.
// De .describe()-teksten zijn de toolbeschrijvingen die de LLM-client te zien krijgt:
// server.ts genereert de JSON-inputschema's rechtstreeks uit deze Zod-schema's.
const peildatumSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "peildatum moet YYYY-MM-DD zijn")
    .refine(isEchteKalenderdatum, "peildatum is geen bestaande kalenderdatum")
    .default(vandaag)
    .describe("Datum YYYY-MM-DD waarop de regeling geldig moet zijn; default is vandaag (Europe/Amsterdam).");
// BWB-id valideren op vorm (BWBR + cijfers). De waarde belandt in een CQL-query en een
// repository-URL-pad; een strikt formaat sluit query-/pad-manipulatie uit.
const bwbIdSchema = z
    .string()
    .regex(/^BWBR\d+$/, "bwbId moet de vorm BWBR<cijfers> hebben, bijv. BWBR0004770")
    .describe("BWB-id, bijv. BWBR0004770");
// ── Input schemas ─────────────────────────────────────────────────────────────
export const ZoekInputSchema = z
    .object({
    titel: z
        .string()
        .optional()
        .describe("Zoekterm in de titel, bijv. 'Invorderingswet'"),
    rechtsgebied: z
        .string()
        .optional()
        .describe("bijv. belastingrecht, arbeidsrecht"),
    ministerie: z.string().optional().describe("bijv. Financiën, Justitie"),
    regelingsoort: z
        .enum(["wet", "AMvB", "ministeriele-regeling", "regeling", "besluit"])
        .optional(),
    maxResultaten: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum aantal resultaten (1-50)."),
    peildatum: peildatumSchema,
})
    .refine((d) => d.titel || d.rechtsgebied || d.ministerie || d.regelingsoort, "Geef minimaal één zoekcriterium op (titel, rechtsgebied, ministerie of regelingsoort).");
export const ZoektermInputSchema = z.object({
    bwbId: bwbIdSchema,
    zoekterm: z
        .string()
        .min(1, "zoekterm mag niet leeg zijn")
        .max(200, "zoekterm mag maximaal 200 tekens zijn")
        .describe("Te zoeken begrip. Wildcards: termijn* of *termijn*. " +
        "Booleaans: 'uitstel EN belasting' of 'termijn OF afstel'."),
    peildatum: peildatumSchema,
    maxResultaten: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum aantal artikelen in het resultaat (1-50)."),
    includeerTekst: z
        .boolean()
        .default(false)
        .describe("Voeg de artikeltekst toe aan elk resultaat. Bespaart een extra wettenbank_artikel-aanroep."),
});
export const ArtikelInputSchema = z.object({
    bwbId: bwbIdSchema,
    artikel: z
        .string()
        .min(1, "artikel mag niet leeg zijn")
        .describe("Artikelnummer, bijv. '25', '9a' of '3:40'."),
    lid: z
        .string()
        .nullish()
        .describe("Optioneel lidnummer; geeft alleen dat lid terug."),
    peildatum: peildatumSchema,
});
export const StructuurInputSchema = z.object({
    bwbId: bwbIdSchema,
    peildatum: peildatumSchema,
    diepte: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Beperk de boom tot dit aantal niveaus; afgekapte secties krijgen ingekort=true. " +
        "Handig bij zeer grote wetten."),
    sectie: z
        .string()
        .optional()
        .describe("Toon alleen de sectie(s) met dit nummer of deze titel (bv. 'II' of 'Invordering')."),
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
    // Aantal geretourneerde (gededupliceerde) regelingen in dit antwoord.
    totaal: z.number(),
    // Totaal aantal treffers bij de bron (SRU numberOfRecords); null als de bron
    // dat niet meldde. Bij totaalBeschikbaar > totaal is het resultaat afgekapt.
    totaalBeschikbaar: z.number().nullable(),
    // false = er waren meer treffers dan maxResultaten; verfijn de zoekopdracht.
    isVolledig: z.boolean(),
    regelingen: z.array(RegelingSchema),
});
export const ZoektermOutputSchema = z.object({
    formaat: z.literal("plain"),
    citeertitel: z.string(),
    versiedatum: z.string(),
    bwbId: z.string(),
    zoekterm: z.string(),
    // null wanneer isVolledig=false (toekomstige streaming-implementatie);
    // bij DOM-parsing (volledige scan) is dit altijd een getal.
    totaalTreffers: z.number().nullable(),
    // true = volledige scan uitgevoerd; false = afgebroken na maxResultaten (nog niet geïmplementeerd voor DOM)
    isVolledig: z.boolean(),
    aantalArtikelen: z.number(),
    artikelen: z.array(z.object({
        artikel: z.string(),
        aantalTreffers: z.number(),
        leden: z.array(z.string()),
        bronreferentie: z.string(), // jci-uri incl. versie (&g=)
        pad: z.string().optional(), // alleen bij includeerTekst=true
        tekst: z.string().optional(), // alleen bij includeerTekst=true
        formaat: z.enum(["plain", "markdown"]).optional(),
    })),
});
export const ArtikelOutputSchema = z.object({
    formaat: z.enum(["plain", "markdown"]),
    citeertitel: z.string(),
    type: z.string().optional(), // regelingsoort (wet, AMvB, …) uit de SRU-metadata
    versiedatum: z.string(),
    geldigVanaf: z.string().optional(),
    geldigTot: z.string().optional(),
    gewijzigd: z.string().optional(),
    bwbId: z.string(),
    artikel: z.string(),
    lid: z.string().optional(),
    sectie: z.string().optional(),
    pad: z.string().optional(), // bijv. "Hoofdstuk 2 > Afdeling 2.1 > Artikel 5"
    leden: z.array(z.object({
        lid: z.string(),
        tekst: z.string(),
        bronreferentie: z.string(), // lid- en versiespecifieke jci-uri
    })),
    bronreferentie: z.string(),
    waarschuwing: z.string().nullable().optional(),
});
// Recursief schema voor de wet-structuur
const _StructuurNodeBase = z.object({
    type: z.string(),
    nr: z.string(),
    titel: z.string().optional(),
    artikelen: z.array(z.string()).optional(),
    // true = sub-secties weggelaten door de diepte-parameter; vraag opnieuw met
    // sectie=<nr> voor de details.
    ingekort: z.boolean().optional(),
});
export const StructuurNodeSchema = _StructuurNodeBase.extend({
    secties: z.lazy(() => z.array(StructuurNodeSchema)).optional(),
});
export const StructuurOutputSchema = z.object({
    formaat: z.literal("plain"),
    bwbId: z.string(),
    citeertitel: z.string(),
    type: z.string().optional(), // regelingsoort uit de SRU-metadata
    versiedatum: z.string(),
    structuur: z.array(StructuurNodeSchema),
});
// Foutformat — `fout` blijft de stabiele, backward-compatibele sleutel; `foutCode` en
// `klasse` zijn optionele diagnose-velden (transient|permanent|client|onbekend).
export const FoutOutputSchema = z.object({
    fout: z.string(),
    foutCode: z.string().optional(),
    klasse: z.enum(["transient", "permanent", "client", "onbekend"]).optional(),
});
