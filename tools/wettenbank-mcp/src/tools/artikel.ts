/**
 * Tool handler: wettenbank_artikel
 * Haalt één artikel op en retourneert gestructureerde Markdown-JSON.
 */

import { ArtikelInputSchema } from "../shared/schemas.js";
import { detecteerFormaat } from "../shared/utils.js";
import {
  haalWetstekstOp,
  extraheerDocMetadata,
  zoekPadEnElementInDom,
} from "../clients/repository-client.js";
import {
  parseElement,
  normalizeNode,
  transformToMcpLite,
} from "../bwb-parser/index.js";

export async function handleArtikel(args: unknown): Promise<string> {
  const parsed = ArtikelInputSchema.safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const { bwbId, artikel, lid, peildatum } = parsed.data;
  const lidnr = lid?.trim() || null;

  const { doc, regeling } = await haalWetstekstOp(bwbId, peildatum);
  const meta = extraheerDocMetadata(doc);
  const wetNaam = meta.citeertitel || regeling.titel;

  const gevonden = zoekPadEnElementInDom(doc.documentElement, artikel);
  if (!gevonden) {
    return JSON.stringify({ fout: `Artikel ${artikel} niet gevonden.` });
  }
  const { element: artikelElement, containerPad } = gevonden;

  const rawNode = parseElement(artikelElement, bwbId, []);
  const normalized = normalizeNode(rawNode);
  let results = transformToMcpLite(normalized, bwbId, wetNaam);

  if (lidnr) {
    results = results.filter((n) => n.sectie.endsWith(` > Lid ${lidnr}`));
  }

  // sectie = artikel-label uit het eerste resultaat (bijv. "Artikel 9")
  const eersteSectie = results[0]?.sectie ?? "";
  const sectionDelen = eersteSectie.split(" > ");
  const padDelen = sectionDelen.filter((d) => !d.startsWith("Lid "));
  const sectie = padDelen[padDelen.length - 1] || undefined;
  // pad = volledig hiërarchisch pad inclusief containers (bijv. "Hoofdstuk V > Afdeling 5.1 > Artikel 9")
  // Alleen aanwezig als het artikel in een container zit
  const pad = containerPad.length > 0 && sectie
    ? [...containerPad, sectie].join(" > ")
    : undefined;

  const ledenData = results.map((r) => ({
    lid: r.sectie.match(/Lid (.*)$/)?.[1] || "",
    tekst: r.tekst,
  }));

  const alleeTekst = ledenData.map((l) => l.tekst).join("\n");
  const formaat = detecteerFormaat(alleeTekst);

  return JSON.stringify({
    formaat,
    citeertitel: wetNaam,
    versiedatum: meta.versiedatum || regeling.geldigVanaf,
    bwbId,
    artikel,
    ...(lidnr && { lid: lidnr }),
    ...(sectie && { sectie }),
    ...(pad && { pad }),
    leden: ledenData,
    bronreferentie: `jci1.3:c:${bwbId}&artikel=${artikel}`,
  });
}
