/**
 * Repository-client voor officiele-overheidspublicaties.nl
 * Haalt BWB-wetstekst XML op, beheert in-memory cache en extraheert doc-metadata.
 */
import { sruRequest, parseRecords, parseXmlDoc, getElText, getAttr, isVertrouwdeRepoUrl, } from "./sru-client.js";
import { fetchMetRetry } from "./http.js";
import { log } from "../logger.js";
export const xmlCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 uur
// Bovengrens op het aantal entries (elke entry bevat de volledige rauwe XML + geparsed
// Document, dus potentieel MB's). Naast de TTL voorkomt dit onbegrensde groei binnen
// één uur bij veel verschillende bwbId×datum-combinaties (LRU-evictie).
const MAX_CACHE_ENTRIES = 50;
// Bovengrens per entry: wetten groter dan 5 MB (bijv. Omgevingswet) worden niet gecached
// om te voorkomen dat één grote wet een onevenredig groot deel van het geheugen inneemt.
const MAX_XML_BYTES = 5 * 1024 * 1024;
// Verwijder verlopen entries elk uur zodat de cache niet onbegrensd groeit.
setInterval(() => {
    const nu = Date.now();
    for (const [key, entry] of xmlCache) {
        if (nu - entry.timestamp > CACHE_TTL)
            xmlCache.delete(key);
    }
}, CACHE_TTL).unref();
function getCacheKey(bwbId, peildatum) {
    return `${bwbId}|${peildatum}`;
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function vandaag() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
// ── Functies ──────────────────────────────────────────────────────────────────
export async function haalWetstekstOp(bwbId, peildatum) {
    const datum = peildatum ?? vandaag();
    const cacheKey = getCacheKey(bwbId, datum);
    const cached = xmlCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        // LRU: verversde toegang naar achteren verplaatsen.
        xmlCache.delete(cacheKey);
        xmlCache.set(cacheKey, cached);
        return { rawXml: cached.rawXml, doc: cached.doc, regeling: cached.regeling };
    }
    const sruXml = await sruRequest(`dcterms.identifier==${bwbId} and overheidbwb.geldigheidsdatum==${datum}`, 1);
    const lijst = parseRecords(sruXml);
    if (!lijst.length) {
        throw new Error(`Geen regeling gevonden voor BWB-id: ${bwbId} op datum ${datum}.`);
    }
    const r = lijst[0];
    // SSRF-vangnet (defence-in-depth): parseRecords filtert al, maar we fetchen hier
    // rechtstreeks, dus weigeren we expliciet elke niet-vertrouwde repository-URL.
    if (!isVertrouwdeRepoUrl(r.repositoryUrl)) {
        throw new Error(`Niet-vertrouwde wetstekst-URL geweigerd voor BWB-id: ${bwbId}.`);
    }
    const resp = await fetchMetRetry(r.repositoryUrl, {}, { timeoutMs: 15_000, bron: "Wetstekst-repository" });
    if (!resp.ok)
        throw new Error(`Wetstekst repository onbereikbaar: ${resp.status}`);
    const rawXml = await resp.text();
    const doc = parseXmlDoc(rawXml, "wetstekst-repository");
    // LRU-cap: gooi de oudste entry weg vóór we de nieuwe toevoegen.
    if (xmlCache.size >= MAX_CACHE_ENTRIES) {
        const oudste = xmlCache.keys().next().value;
        if (oudste !== undefined)
            xmlCache.delete(oudste);
    }
    const result = { rawXml, doc, regeling: r };
    if (rawXml.length > MAX_XML_BYTES) {
        log("warn", "functioneel", "wetstekst te groot voor cache — wordt niet gecacht", {
            bwbId,
            bytes: rawXml.length,
        });
        return result;
    }
    xmlCache.set(cacheKey, { ...result, timestamp: Date.now() });
    return result;
}
export function extraheerDocMetadata(doc) {
    const toestand = doc.getElementsByTagName("toestand")[0];
    const versiedatum = toestand ? getAttr(toestand, "inwerkingtredingsdatum") : "";
    const regelingInfo = doc.getElementsByTagName("regeling-info")[0];
    const citeertitel = regelingInfo ? getElText(regelingInfo, "citeertitel") : "";
    return { citeertitel, versiedatum };
}
// Tags die structurele containers vormen (directe ancestors in het hiërarchisch pad)
const CONTAINER_TAGS_DOM = new Set([
    "boek", "deel", "hoofdstuk", "titel", "afdeling", "paragraaf", "subparagraaf",
    "circulaire-tekst",
]);
/** Extraheert het leesbare label van een container-element via zijn <kop>. */
function bouwContainerLabel(el) {
    const kop = el.getElementsByTagName("kop")[0];
    if (!kop)
        return null;
    const label = getElText(kop, "label");
    const nr = getElText(kop, "nr");
    const titel = getElText(kop, "titel");
    return [label, nr, titel].filter(Boolean).join(" ") || null;
}
/**
 * Zoekt een artikel-element in de DOM en geeft zowel het element als het
 * container-pad terug (bijv. ["Hoofdstuk V", "Afdeling 5.1"]).
 * Bevat geen artikel-label zelf — alleen de omvattende containers.
 */
export function zoekPadEnElementInDom(el, artikelnummer, huidigPad = []) {
    if (el.nodeType !== 1)
        return null;
    const tag = el.tagName;
    if (tag === "artikel" || tag === "circulaire.divisie") {
        const nr = getElText(el.getElementsByTagName("kop")[0], "nr");
        if (nr === artikelnummer)
            return { element: el, containerPad: huidigPad };
    }
    const label = CONTAINER_TAGS_DOM.has(tag) ? bouwContainerLabel(el) : null;
    const nieuwPad = label ? [...huidigPad, label] : huidigPad;
    for (let i = 0; i < el.childNodes.length; i++) {
        const found = zoekPadEnElementInDom(el.childNodes.item(i), artikelnummer, nieuwPad);
        if (found)
            return found;
    }
    return null;
}
export function zoekElementInDom(el, artikelnummer) {
    return zoekPadEnElementInDom(el, artikelnummer)?.element ?? null;
}
export function extractTextForSearch(el) {
    if (el.nodeType === 3)
        return el.nodeValue ?? "";
    if (el.nodeType !== 1)
        return "";
    if (el.tagName === "kop")
        return "";
    let text = "";
    for (let i = 0; i < el.childNodes.length; i++) {
        text += extractTextForSearch(el.childNodes.item(i));
    }
    return text;
}
