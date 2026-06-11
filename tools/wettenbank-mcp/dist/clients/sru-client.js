/**
 * SRU-client voor zoekservice.overheid.nl
 * Verantwoordelijk voor HTTP-requests en XML-parsing van SRU-responses.
 */
import { DOMParser } from "@xmldom/xmldom";
import { log } from "../logger.js";
import { UpstreamError } from "../shared/fouten.js";
import { fetchMetRetry } from "./http.js";
export const SRU_BASE = "https://zoekservice.overheid.nl/sru/Search";
export const REPO_BASE = "https://repository.officiele-overheidspublicaties.nl/bwb";
const REPO_HOST = "repository.officiele-overheidspublicaties.nl";
export const domParser = new DOMParser();
/**
 * Beveiliging (SSRF): de `repositoryUrl` komt uit de SRU-respons
 * (`overheidbwb:locatie_toestand`) en is dus door de bron bepaald. We fetchen die
 * URL later rechtstreeks, dus accepteren we alleen `https:` naar de bekende
 * repository-host. Niet-vertrouwde waarden vallen terug op een zelf-geconstrueerde URL.
 */
export function isVertrouwdeRepoUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && u.hostname === REPO_HOST;
    }
    catch {
        return false;
    }
}
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
/**
 * Parseert XML strikt: een `fatalError` gooit xmldom zelf al; daarnaast vangen we
 * een ontbrekend `documentElement` af. Zo lekt malformed/leeg XML niet stil door
 * als een lege resultaatlijst, maar als een expliciete fout met bronvermelding.
 */
export function parseXmlDoc(xml, bron) {
    let doc;
    try {
        doc = domParser.parseFromString(xml, "text/xml");
    }
    catch (err) {
        throw new Error(`Ongeldige XML van ${bron}: ${err.message}`);
    }
    if (!doc || !doc.documentElement) {
        throw new Error(`Ongeldige of lege XML-respons van ${bron}`);
    }
    return doc;
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
    const res = await fetchMetRetry(`${SRU_BASE}?${params}`, { headers: { Accept: "application/xml" } }, { timeoutMs: FETCH_TIMEOUT_MS, bron: "SRU" });
    if (!res.ok)
        throw new UpstreamError(`SRU HTTP ${res.status}`, {
            bron: "SRU",
            url: SRU_BASE,
            httpStatus: res.status,
        });
    return res.text();
}
/**
 * Snelle bereikbaarheidscheck van de upstream-hosts voor `/ready`. Elke HTTP-respons
 * (ook 3xx/4xx) telt als bereikbaar; alleen een netwerk-/TLS-fout betekent "down".
 * Korte timeout, géén retry — dit is een readiness-probe, geen tool-call.
 */
async function bereikbaar(url, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        await fetch(url, { method: "HEAD", signal: controller.signal });
        return true;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(t);
    }
}
export async function upstreamStatus(timeoutMs = 3000) {
    const [sru, repository] = await Promise.all([
        bereikbaar(`${SRU_BASE}?operation=explain&version=2.0`, timeoutMs),
        bereikbaar(`${REPO_BASE}/`, timeoutMs),
    ]);
    return { sru, repository };
}
export function parseRecords(xml) {
    const doc = parseXmlDoc(xml, "SRU-service");
    const records = Array.from(doc.getElementsByTagName("record"));
    const geparsed = records.map((rec) => {
        const gzd = rec.getElementsByTagName("gzd")[0];
        const owmskern = gzd?.getElementsByTagName("owmskern")[0];
        const bwbipm = gzd?.getElementsByTagName("bwbipm")[0];
        const enrich = gzd?.getElementsByTagName("enrichedData")[0];
        const bwbId = getElText(owmskern, "dcterms:identifier");
        const rgEls = bwbipm ? Array.from(bwbipm.getElementsByTagName("overheidbwb:rechtsgebied")) : [];
        const rechtsgebiedStr = rgEls.map((e) => e.textContent?.trim()).filter(Boolean).join(", ");
        // SSRF-mitigatie: vertrouw de bron-URL alleen als hij naar de bekende repository wijst;
        // anders een zelf-geconstrueerde URL gebruiken (vaste host, geen door de bron gestuurd doel).
        const bronUrl = getElText(enrich, "overheidbwb:locatie_toestand");
        const repositoryUrl = bronUrl && isVertrouwdeRepoUrl(bronUrl) ? bronUrl : `${REPO_BASE}/${bwbId}/`;
        return {
            bwbId,
            titel: getElText(owmskern, "dcterms:title"),
            type: getElText(owmskern, "dcterms:type"),
            ministerie: getElText(owmskern, "overheid:authority"),
            rechtsgebied: rechtsgebiedStr,
            geldigVanaf: getElText(bwbipm, "overheidbwb:geldigheidsperiode_startdatum"),
            geldigTot: getElText(bwbipm, "overheidbwb:geldigheidsperiode_einddatum") || "onbepaald",
            gewijzigd: getElText(owmskern, "dcterms:modified"),
            repositoryUrl,
        };
    });
    // Records zonder bwbId óf titel zijn onbruikbaar (bv. ontbrekend <gzd>): weglaten i.p.v.
    // stil lege velden teruggeven, en het aantal overgeslagen records zichtbaar maken.
    const volledig = geparsed.filter((r) => r.bwbId && r.titel);
    if (volledig.length < geparsed.length) {
        log("warn", "functioneel", "onvolledige SRU-records overgeslagen", {
            overgeslagen: geparsed.length - volledig.length,
            totaal: geparsed.length,
        });
    }
    return volledig;
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
