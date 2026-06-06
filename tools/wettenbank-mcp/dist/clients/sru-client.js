/**
 * SRU-client voor zoekservice.overheid.nl
 * Verantwoordelijk voor HTTP-requests en XML-parsing van SRU-responses.
 */
import { DOMParser } from "@xmldom/xmldom";
const SRU_BASE = "https://zoekservice.overheid.nl/sru/Search";
export const REPO_BASE = "https://repository.officiele-overheidspublicaties.nl/bwb";
export const domParser = new DOMParser();
// ── Helpers ──────────────────────────────────────────────────────────────────
export function stripXml(xml) {
    return xml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function getElText(parent, tagName) {
    if (!parent)
        return "";
    const el = parent.getElementsByTagName(tagName)[0];
    return el?.textContent?.trim() ?? "";
}
export function getAttr(el, attrName) {
    if (!el)
        return "";
    return el.getAttribute(attrName) ?? "";
}
// ── SRU client ───────────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 15_000;
export async function sruRequest(query, maxRecords = 10) {
    const params = new URLSearchParams({
        operation: "searchRetrieve",
        version: "2.0",
        "x-connection": "BWB",
        query,
        maximumRecords: String(maxRecords),
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(`${SRU_BASE}?${params}`, {
            headers: { Accept: "application/xml" },
            signal: controller.signal,
        });
        if (!res.ok)
            throw new Error(`SRU HTTP ${res.status}`);
        return res.text();
    }
    finally {
        clearTimeout(timeoutId);
    }
}
export function parseRecords(xml) {
    const doc = domParser.parseFromString(xml, "text/xml");
    const records = Array.from(doc.getElementsByTagName("record"));
    return records.map((rec) => {
        const gzd = rec.getElementsByTagName("gzd")[0];
        const owmskern = gzd?.getElementsByTagName("owmskern")[0];
        const bwbipm = gzd?.getElementsByTagName("bwbipm")[0];
        const enrich = gzd?.getElementsByTagName("enrichedData")[0];
        const bwbId = getElText(owmskern, "dcterms:identifier");
        const rgEls = bwbipm ? Array.from(bwbipm.getElementsByTagName("overheidbwb:rechtsgebied")) : [];
        const rechtsgebiedStr = rgEls.map((e) => e.textContent?.trim()).filter(Boolean).join(", ");
        return {
            bwbId,
            titel: getElText(owmskern, "dcterms:title"),
            type: getElText(owmskern, "dcterms:type"),
            ministerie: getElText(owmskern, "overheid:authority"),
            rechtsgebied: rechtsgebiedStr,
            geldigVanaf: getElText(bwbipm, "overheidbwb:geldigheidsperiode_startdatum"),
            geldigTot: getElText(bwbipm, "overheidbwb:geldigheidsperiode_einddatum") || "onbepaald",
            gewijzigd: getElText(owmskern, "dcterms:modified"),
            repositoryUrl: getElText(enrich, "overheidbwb:locatie_toestand") || `${REPO_BASE}/${bwbId}/`,
        };
    });
}
export function dedupliceerOpBwbId(lijst) {
    const map = new Map();
    for (const r of lijst) {
        const bestaande = map.get(r.bwbId);
        if (!bestaande || r.geldigVanaf > bestaande.geldigVanaf) {
            map.set(r.bwbId, r);
        }
    }
    return Array.from(map.values());
}
