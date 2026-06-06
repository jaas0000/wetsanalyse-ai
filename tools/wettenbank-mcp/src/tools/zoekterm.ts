/**
 * Tool handler: wettenbank_zoekterm
 * Zoekt artikelen die een begrip bevatten; optioneel met artikeltekst.
 */

import { ZoektermInputSchema } from "../shared/schemas.js";
import { detecteerFormaat } from "../shared/utils.js";
import {
  haalWetstekstOp,
  extraheerDocMetadata,
  zoekElementInDom,
} from "../clients/repository-client.js";
import { parseZoekterm, zoekTermInArtikelDom } from "../search/zoekterm-engine.js";
import {
  parseElement,
  normalizeNode,
  transformToMcpLite,
} from "../bwb-parser/index.js";

export async function handleZoekterm(args: unknown): Promise<string> {
  const parsed = ZoektermInputSchema.safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const { bwbId, zoekterm, peildatum, maxResultaten, includeerTekst } = parsed.data;

  const { doc, regeling } = await haalWetstekstOp(bwbId, peildatum);
  const meta = extraheerDocMetadata(doc);
  const wetNaam = meta.citeertitel || regeling.titel;

  const resultaat = zoekTermInArtikelDom(doc, parseZoekterm(zoekterm), maxResultaten);

  // Voeg optioneel artikeltekst toe
  const artikelen = await Promise.all(
    resultaat.artikelen.map(async (art) => {
      if (!includeerTekst) return art;

      const artikelElement = zoekElementInDom(doc.documentElement, art.artikel);
      if (!artikelElement) return art;

      const rawNode = parseElement(artikelElement, bwbId, []);
      const normalized = normalizeNode(rawNode);
      const mcpNodes = transformToMcpLite(normalized, bwbId, wetNaam);
      const tekst = mcpNodes.map((n) => n.tekst).join("\n\n");
      const formaat = detecteerFormaat(tekst);

      return { ...art, tekst, formaat };
    })
  );

  return JSON.stringify({
    formaat: "plain",
    wet: wetNaam,
    versiedatum: meta.versiedatum || regeling.geldigVanaf,
    bwbId,
    zoekterm,
    totaalTreffers: resultaat.totaalTreffers,
    isVolledig: resultaat.isVolledig,
    aantalArtikelen: artikelen.length,
    artikelen,
  });
}
