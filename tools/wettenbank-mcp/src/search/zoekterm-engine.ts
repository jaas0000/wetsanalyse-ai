/**
 * Zoekterm-engine: wildcard-regex en EN/OF-logica voor full-text doorzoeken van BWB-XML.
 */

import { extractTextForSearch } from "../clients/repository-client.js";
import { getElText } from "../clients/sru-client.js";

type XDocument = any;
type XElement = any;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZoekInput =
  | RegExp
  | { patronen: RegExp[]; operator: "EN" | "OF" };

export interface ZoekTermResultaat {
  artikelen: { artikel: string; aantalTreffers: number; leden: string[] }[];
  totaalTreffers: number;
  isVolledig: boolean;
}

// ── Hulpfuncties ──────────────────────────────────────────────────────────────

export function escapeerRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function bouwTermPatroon(zoekterm: string): string {
  const heeftPrefix = zoekterm.startsWith("*");
  const heeftSuffix = zoekterm.endsWith("*");
  const kern = escapeerRegex(zoekterm.replace(/^\*|\*$/g, ""));
  const pre  = heeftPrefix ? "\\w*" : "\\b";
  const post = heeftSuffix ? "\\w*" : "\\b";
  return `${pre}${kern}${post}`;
}

// ── Publieke API ──────────────────────────────────────────────────────────────

// Operatoren worden case-insensitief en op woordgrenzen herkend, zodat zowel
// "uitstel EN belasting" als "uitstel en belasting" werkt en "ENERGIE" níét als
// operator telt. EN/AND betekenen EN; OF/OR betekenen OF.
const EN_OPERATOR = /\s+(?:EN|AND)\s+/i;
const SPLIT_EN = /\s+(?:EN|AND)\s+/gi;
const SPLIT_OF = /\s+(?:OF|OR)\s+/gi;

export function parseZoekterm(zoekterm: string): ZoekInput {
  const operator: "EN" | "OF" = EN_OPERATOR.test(zoekterm) ? "EN" : "OF";
  const delen = zoekterm
    .split(operator === "EN" ? SPLIT_EN : SPLIT_OF)
    .map((p) => p.trim())
    // Weiger lege deeltermen en bare wildcards (zouden overal/leeg matchen).
    .filter((p) => p && p.replace(/\*/g, "").length > 0);

  // Eén bron van waarheid voor het patroon: hergebruik bouwTermPatroon, zodat het
  // werkelijk gebruikte pad gelijk is aan wat de unit-tests dekken.
  const patronen = delen.map((p) => new RegExp(bouwTermPatroon(p), "gi"));

  // Geen geldige term over (bijv. invoer "*"): geef een patroon dat nooit matcht.
  if (patronen.length === 0) return { patronen: [/(?!)/gi], operator };

  return { patronen, operator };
}

export function zoekTermInArtikelDom(
  doc: XDocument | XElement,
  invoer: ZoekInput,
  maxResultaten = 10
): ZoekTermResultaat {
  const { patronen, operator } =
    invoer instanceof RegExp
      ? { patronen: [invoer], operator: "OF" as const }
      : invoer;

  const tellers = new Map<
    string,
    { count: number; leden: Set<string>; matchedPatterns: Set<number> }
  >();

  const articles: XElement[] = [
    ...Array.from(doc.getElementsByTagName("artikel")),
    ...Array.from(doc.getElementsByTagName("circulaire.divisie")),
  ];

  for (const art of articles) {
    const nr = getElText(art.getElementsByTagName("kop")[0], "nr");
    if (!nr) continue;

    const entry = tellers.get(nr) ?? {
      count: 0,
      leden: new Set<string>(),
      matchedPatterns: new Set<number>(),
    };
    const clean = extractTextForSearch(art);

    patronen.forEach((pat, i) => {
      pat.lastIndex = 0;
      const matches = clean.match(pat);
      if (matches) {
        const toAdd = Math.min(matches.length, 100 - entry.count);
        entry.count += toAdd;
        entry.matchedPatterns.add(i);
        tellers.set(nr, entry);
      }
    });

    const lids = Array.from(art.getElementsByTagName("lid"));
    for (const lid of lids as XElement[]) {
      const lidnr = getElText(lid, "lidnr");
      if (!lidnr) continue;
      const lidText = extractTextForSearch(lid);
      if (patronen.some((pat) => { pat.lastIndex = 0; return pat.test(lidText); })) {
        entry.leden.add(lidnr);
      }
    }
  }

  const alleArtikelen = Array.from(tellers.entries())
    .filter(([, { matchedPatterns }]) =>
      operator === "EN"
        ? matchedPatterns.size === patronen.length
        : matchedPatterns.size > 0
    )
    .map(([artikel, { count, leden }]) => ({
      artikel,
      aantalTreffers: count,
      leden: Array.from(leden).sort((a, b) => {
        const nA = parseFloat(a), nB = parseFloat(b);
        if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
        return a.localeCompare(b);
      }),
    }))
    .sort((a, b) => {
      const nA = parseFloat(a.artikel), nB = parseFloat(b.artikel);
      if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
      return a.artikel.localeCompare(b.artikel);
    });

  const totaalTreffers = alleArtikelen.reduce((s, t) => s + t.aantalTreffers, 0);
  return {
    artikelen: alleArtikelen.slice(0, maxResultaten),
    totaalTreffers,
    isVolledig: true, // DOM-parsing scant altijd het volledige document
  };
}
