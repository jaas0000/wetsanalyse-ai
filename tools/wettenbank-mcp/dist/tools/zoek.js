/**
 * Tool handler: wettenbank_zoek
 * Zoekt Nederlandse regelingen via SRU en retourneert metadata.
 */
import { ZoekInputSchema } from "../shared/schemas.js";
import { sruRequest, parseRecords, dedupliceerOpBwbId } from "../clients/sru-client.js";
export async function handleZoek(args) {
    const parsed = ZoekInputSchema.safeParse(args);
    if (!parsed.success)
        throw new Error(parsed.error.issues[0].message);
    const { titel, rechtsgebied, ministerie, regelingsoort, maxResultaten, peildatum } = parsed.data;
    // Escape dubbele quotes in zoekwaarden zodat een titel met " de CQL-query niet breekt.
    const cql = (s) => s.replace(/"/g, '\\"');
    const queryDelen = [];
    if (titel)
        queryDelen.push(`overheidbwb.titel any "${cql(titel)}"`);
    if (rechtsgebied)
        queryDelen.push(`overheidbwb.rechtsgebied == "${cql(rechtsgebied)}"`);
    if (ministerie)
        queryDelen.push(`overheid.authority == "${cql(ministerie)}"`);
    if (regelingsoort)
        queryDelen.push(`dcterms.type == "${cql(regelingsoort)}"`);
    queryDelen.push(`overheidbwb.geldigheidsdatum==${peildatum}`);
    const xml = await sruRequest(queryDelen.join(" and "), maxResultaten);
    const regelingen = dedupliceerOpBwbId(parseRecords(xml));
    return JSON.stringify({
        formaat: "plain",
        totaal: regelingen.length,
        regelingen,
    });
}
