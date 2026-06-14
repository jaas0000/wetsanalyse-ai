/**
 * Tool handler: wettenbank_artikel
 * Haalt één artikel op en retourneert gestructureerde Markdown-JSON.
 */

import { ArtikelInputSchema } from "../shared/schemas.js";
import { detecteerFormaat, formatteerZodFout } from "../shared/utils.js";
import { ClientInputError } from "../shared/fouten.js";
import {
  haalWetstekstOp,
  extraheerDocMetadata,
  zoekArtikelElementen,
  verzamelArtikelnummers,
} from "../clients/repository-client.js";
import {
  parseElement,
  normalizeNode,
  transformToMcpLite,
} from "../bwb-parser/index.js";

/** Artikelnummers die op de gevraagde invoer lijken (prefix-verwantschap), voor suggesties. */
function zoekSuggesties(gevraagd: string, beschikbaar: string[]): string[] {
  const z = gevraagd.trim().toLowerCase();
  const uniek = [...new Set(beschikbaar)];
  return uniek
    .filter((nr) => {
      const n = nr.trim().toLowerCase();
      return n !== z && (n.startsWith(z) || z.startsWith(n));
    })
    .slice(0, 5);
}

export async function handleArtikel(args: unknown, signaal?: AbortSignal): Promise<string> {
  const parsed = ArtikelInputSchema.safeParse(args);
  if (!parsed.success) throw new ClientInputError(formatteerZodFout(parsed.error));

  const { bwbId, artikel, lid, peildatum } = parsed.data;
  const lidnr = lid?.trim() || null;

  const { doc, regeling } = await haalWetstekstOp(bwbId, peildatum, signaal);
  const meta = extraheerDocMetadata(doc);
  const wetNaam = meta.citeertitel || regeling.titel;
  const versiedatum = meta.versiedatum || regeling.geldigVanaf;
  const root = doc.documentElement!;

  const treffers = zoekArtikelElementen(root, artikel);
  if (treffers.length === 0) {
    const suggesties = zoekSuggesties(artikel, verzamelArtikelnummers(root));
    throw new ClientInputError(
      `Artikel ${artikel} niet gevonden in ${bwbId} (peildatum ${peildatum}).` +
        (suggesties.length ? ` Bestaat wel: ${suggesties.join(", ")}.` : "") +
        " Roep wettenbank_structuur aan voor de geldige artikelnummers;" +
        " vervallen artikelen laten gaten in de nummering achter."
    );
  }
  const { element: artikelElement, containerPad } = treffers[0];
  const waarschuwing =
    treffers.length > 1
      ? `Er zijn ${treffers.length} elementen met nummer ${artikel} (bijv. ook in een ` +
        `bijlage); het eerste exemplaar is gebruikt` +
        (treffers[1].containerPad.length
          ? `, een ander staat onder "${treffers[1].containerPad.join(" > ")}".`
          : ".")
      : undefined;

  const rawNode = parseElement(artikelElement, bwbId, []);
  const normalized = normalizeNode(rawNode);
  let results = transformToMcpLite(normalized, bwbId, wetNaam, versiedatum);

  if (lidnr) {
    const beschikbareLeden = results
      .map((r) => r.sectie.match(/Lid (.*)$/)?.[1])
      .filter((l): l is string => Boolean(l));
    results = results.filter((n) => n.sectie.endsWith(` > Lid ${lidnr}`));
    if (results.length === 0) {
      // Expliciet falen i.p.v. een lege leden-array: een stil leeg resultaat nodigt
      // een LLM-client uit om tekst te "raden" — precies wat hier nooit mag.
      throw new ClientInputError(
        `Lid ${lidnr} niet gevonden in artikel ${artikel} van ${bwbId}. ` +
          (beschikbareLeden.length
            ? `Beschikbare leden: ${beschikbareLeden.join(", ")}.`
            : "Dit artikel heeft geen genummerde leden; vraag het op zonder lid-parameter.")
      );
    }
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

  // Lid- en versiespecifieke jci-bronreferentie per lid (traceerbaarheid: een
  // lid-2-analyse op peildatum X moet naar precies die tekst verwijzen).
  const jciVoor = (lidNr: string) =>
    `jci1.3:c:${bwbId}&artikel=${artikel}` +
    (lidNr ? `&lid=${lidNr}` : "") +
    (versiedatum ? `&g=${versiedatum}` : "");

  const ledenData = results.map((r) => {
    const lidVanResultaat = r.sectie.match(/Lid (.*)$/)?.[1] || "";
    return {
      lid: lidVanResultaat,
      tekst: r.tekst,
      bronreferentie: jciVoor(lidVanResultaat),
      ...(r.verwijzingen && r.verwijzingen.length > 0 ? { verwijzingen: r.verwijzingen } : {}),
    };
  });

  const alleeTekst = ledenData.map((l) => l.tekst).join("\n");
  const formaat = detecteerFormaat(alleeTekst);

  return JSON.stringify({
    formaat,
    citeertitel: wetNaam,
    ...(regeling.type && { type: regeling.type }),
    versiedatum,
    // Geldigheidsmetadata van de toestand — voor traceerbaarheid: sinds/tot wanneer geldt
    // deze versie en wanneer is ze laatst gewijzigd (relevant voor wetsanalyse).
    geldigVanaf: regeling.geldigVanaf,
    geldigTot: regeling.geldigTot,
    gewijzigd: regeling.gewijzigd,
    bwbId,
    artikel,
    ...(lidnr && { lid: lidnr }),
    ...(sectie && { sectie }),
    ...(pad && { pad }),
    leden: ledenData,
    bronreferentie: jciVoor(lidnr ?? ""),
    ...(waarschuwing && { waarschuwing }),
  });
}
