/**
 * Tool handler: wettenbank_zoek
 * Zoekt Nederlandse regelingen via SRU en retourneert metadata.
 */

import { ZoekInputSchema } from "../shared/schemas.js";
import { formatteerZodFout } from "../shared/utils.js";
import { ClientInputError } from "../shared/fouten.js";
import {
  sruRequest,
  parseRecords,
  parseAantalRecords,
  dedupliceerOpBwbId,
} from "../clients/sru-client.js";

export async function handleZoek(args: unknown, signaal?: AbortSignal): Promise<string> {
  const parsed = ZoekInputSchema.safeParse(args);
  if (!parsed.success) throw new ClientInputError(formatteerZodFout(parsed.error));

  const { titel, rechtsgebied, ministerie, regelingsoort, maxResultaten, peildatum } = parsed.data;

  // Escape dubbele quotes in zoekwaarden zodat een titel met " de CQL-query niet breekt.
  const cql = (s: string) => s.replace(/"/g, '\\"');

  const queryDelen: string[] = [];
  if (titel) {
    // 'any' is OR-per-woord: "Wet milieubeheer" matcht dan elke wet met "wet" in de
    // titel. Bij meerwoordige titels eist 'all' alle woorden — veel minder ruis.
    const relatie = /\s/.test(titel.trim()) ? "all" : "any";
    queryDelen.push(`overheidbwb.titel ${relatie} "${cql(titel)}"`);
  }
  if (rechtsgebied) queryDelen.push(`overheidbwb.rechtsgebied == "${cql(rechtsgebied)}"`);
  if (ministerie) queryDelen.push(`overheid.authority == "${cql(ministerie)}"`);
  if (regelingsoort) queryDelen.push(`dcterms.type == "${cql(regelingsoort)}"`);
  queryDelen.push(`overheidbwb.geldigheidsdatum==${peildatum}`);

  const xml = await sruRequest(queryDelen.join(" and "), maxResultaten, signaal);
  const records = parseRecords(xml);
  const regelingen = dedupliceerOpBwbId(records);
  // numberOfRecords telt rúwe records (vóór ontdubbeling); records.length is wat we in dít
  // antwoord ophaalden. isVolledig = "alle ruwe records binnen?" — dan kan de ontdubbelde set
  // niets meer missen.
  const totaalRecords = parseAantalRecords(xml);
  const isVolledig = totaalRecords === null ? true : records.length >= totaalRecords;

  return JSON.stringify({
    formaat: "plain",
    totaal: regelingen.length,
    // Houd totaalBeschikbaar op hetzelfde tel-niveau als totaal: volledig → de ontdubbelde set
    // ís compleet (== totaal, geen valse "er is meer"); afgekapt → de ruwe SRU-telling als
    // afkap-signaal. Zo geldt de invariant uit shared/schemas.ts weer: totaalBeschikbaar > totaal
    // ⟹ afgekapt. isVolledig=false → verfijn de zoekopdracht of verhoog maxResultaten.
    totaalBeschikbaar: isVolledig ? regelingen.length : totaalRecords,
    isVolledig,
    regelingen,
  });
}
