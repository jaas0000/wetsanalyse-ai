/**
 * Zoekterm-engine: wildcard-regex en EN/OF-logica voor full-text doorzoeken van BWB-XML.
 */
import { extractTextForSearch } from "../clients/repository-client.js";
import { getElText } from "../clients/sru-client.js";
// ── Hulpfuncties ──────────────────────────────────────────────────────────────
export function escapeerRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function bouwTermPatroon(zoekterm) {
    const heeftPrefix = zoekterm.startsWith("*");
    const heeftSuffix = zoekterm.endsWith("*");
    const kern = escapeerRegex(zoekterm.replace(/^\*|\*$/g, ""));
    const pre = heeftPrefix ? "\\w*" : "\\b";
    const post = heeftSuffix ? "\\w*" : "\\b";
    return `${pre}${kern}${post}`;
}
// ── Publieke API ──────────────────────────────────────────────────────────────
export function parseZoekterm(zoekterm) {
    const t = zoekterm.replace(/ AND /g, " EN ").replace(/ OR /g, " OF ");
    const op = t.includes(" EN ") ? "EN" : "OF";
    const parts = t.split(op === "EN" ? " EN " : " OF ").map((p) => p.trim());
    const regexify = (s) => {
        const kern = s.replace(/\*/g, "");
        const pre = s.startsWith("*") ? "\\w*" : "\\b";
        const post = s.endsWith("*") ? "\\w*" : "\\b";
        return new RegExp(`${pre}${kern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${post}`, "gi");
    };
    return { patronen: parts.map(regexify), operator: op };
}
export function zoekTermInArtikelDom(doc, invoer, maxResultaten = 10) {
    const { patronen, operator } = invoer instanceof RegExp
        ? { patronen: [invoer], operator: "OF" }
        : invoer;
    const tellers = new Map();
    let totaalTreffersTeller = 0;
    const articles = [
        ...Array.from(doc.getElementsByTagName("artikel")),
        ...Array.from(doc.getElementsByTagName("circulaire.divisie")),
    ];
    for (const art of articles) {
        const nr = getElText(art.getElementsByTagName("kop")[0], "nr");
        if (!nr)
            continue;
        const entry = tellers.get(nr) ?? {
            count: 0,
            leden: new Set(),
            matchedPatterns: new Set(),
        };
        const clean = extractTextForSearch(art);
        patronen.forEach((pat, i) => {
            pat.lastIndex = 0;
            const matches = clean.match(pat);
            if (matches) {
                const toAdd = Math.min(matches.length, 100 - entry.count);
                entry.count += toAdd;
                totaalTreffersTeller += toAdd;
                entry.matchedPatterns.add(i);
                tellers.set(nr, entry);
            }
        });
        const lids = Array.from(art.getElementsByTagName("lid"));
        for (const lid of lids) {
            const lidnr = getElText(lid, "lidnr");
            if (!lidnr)
                continue;
            const lidText = extractTextForSearch(lid);
            if (patronen.some((pat) => { pat.lastIndex = 0; return pat.test(lidText); })) {
                entry.leden.add(lidnr);
            }
        }
    }
    const alleArtikelen = Array.from(tellers.entries())
        .filter(([, { matchedPatterns }]) => operator === "EN"
        ? matchedPatterns.size === patronen.length
        : matchedPatterns.size > 0)
        .map(([artikel, { count, leden }]) => ({
        artikel,
        aantalTreffers: count,
        leden: Array.from(leden).sort((a, b) => {
            const nA = parseFloat(a), nB = parseFloat(b);
            if (!isNaN(nA) && !isNaN(nB))
                return nA - nB;
            return a.localeCompare(b);
        }),
    }))
        .sort((a, b) => {
        const nA = parseFloat(a.artikel), nB = parseFloat(b.artikel);
        if (!isNaN(nA) && !isNaN(nB))
            return nA - nB;
        return a.artikel.localeCompare(b.artikel);
    });
    const totaalTreffers = alleArtikelen.reduce((s, t) => s + t.aantalTreffers, 0);
    return {
        artikelen: alleArtikelen.slice(0, maxResultaten),
        totaalTreffers,
        isVolledig: true, // DOM-parsing scant altijd het volledige document
    };
}
