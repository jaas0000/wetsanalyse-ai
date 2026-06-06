/**
 * Tool handler: wettenbank_zoek
 * Zoekt Nederlandse regelingen via SRU en retourneert metadata.
 */

import { ZoekInputSchema } from "../shared/schemas.js";
import { sruRequest, parseRecords, dedupliceerOpBwbId } from "../clients/sru-client.js";

export async function handleZoek(args: unknown): Promise<string> {
  const parsed = ZoekInputSchema.safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const { titel, rechtsgebied, ministerie, regelingsoort, maxResultaten, peildatum } = parsed.data;

  const queryDelen: string[] = [];
  if (titel) queryDelen.push(`overheidbwb.titel any "${titel}"`);
  if (rechtsgebied) queryDelen.push(`overheidbwb.rechtsgebied == "${rechtsgebied}"`);
  if (ministerie) queryDelen.push(`overheid.authority == "${ministerie}"`);
  if (regelingsoort) queryDelen.push(`dcterms.type == "${regelingsoort}"`);
  queryDelen.push(`overheidbwb.geldigheidsdatum==${peildatum}`);

  const xml = await sruRequest(queryDelen.join(" and "), maxResultaten);
  const regelingen = dedupliceerOpBwbId(parseRecords(xml));

  return JSON.stringify({
    formaat: "plain",
    totaal: regelingen.length,
    regelingen,
  });
}
