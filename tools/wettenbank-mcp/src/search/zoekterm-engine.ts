/**
 * Zoekterm-engine: wildcard-regex en EN/OF-logica voor full-text doorzoeken van BWB-XML.
 */

import { extractTextForSearch } from "../clients/repository-client.js";
import { getElText } from "../clients/sru-client.js";
import type { DomDocument, DomElement } from "../shared/dom.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ZoekInput =
  | RegExp
  | { patronen: RegExp[]; operator: "EN" | "OF" };

export interface ZoekTermResultaat {
  artikelen: {
    artikel: string;
    aantalTreffers: number;
    leden: string[];
    waarschuwing?: string;
  }[];
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
  doc: DomDocument | DomElement,
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
  // Hoe vaak elk artikelnummer voorkomt — een bijlage kan de nummering herstarten,
  // waardoor treffers van twee verschillende plekken anders ongemerkt op één
  // nummer worden samengevoegd (vgl. de waarschuwing in wettenbank_artikel).
  const voorkomens = new Map<string, number>();

  const articles: DomElement[] = [
    ...Array.from(doc.getElementsByTagName("artikel")),
    ...Array.from(doc.getElementsByTagName("circulaire.divisie")),
  ];

  for (const art of articles) {
    const nr = getElText(art.getElementsByTagName("kop").item(0), "nr");
    if (!nr) continue;
    voorkomens.set(nr, (voorkomens.get(nr) ?? 0) + 1);

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
        // Geen kunstmatige cap: tellen is goedkoop en een stil geplafonneerd
        // aantal zou totaalTreffers onnauwkeurig maken.
        entry.count += matches.length;
        entry.matchedPatterns.add(i);
        tellers.set(nr, entry);
      }
    });

    const lids = Array.from(art.getElementsByTagName("lid"));
    for (const lid of lids) {
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
    .map(([artikel, { count, leden }]) => {
      const aantal = voorkomens.get(artikel) ?? 1;
      return {
        artikel,
        aantalTreffers: count,
        leden: Array.from(leden).sort((a, b) => {
          const nA = parseFloat(a), nB = parseFloat(b);
          if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
          return a.localeCompare(b);
        }),
        ...(aantal > 1 && {
          waarschuwing:
            `Er zijn ${aantal} elementen met nummer ${artikel} (bijv. ook in een ` +
            `bijlage); de treffers en leden zijn over alle exemplaren samengeteld.`,
        }),
      };
    })
    .sort((a, b) => {
      const nA = parseFloat(a.artikel), nB = parseFloat(b.artikel);
      if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
      return a.artikel.localeCompare(b.artikel);
    });

  const totaalTreffers = alleArtikelen.reduce((s, t) => s + t.aantalTreffers, 0);
  // isVolledig=false ⇒ de artikellijst is na maxResultaten afgekapt; de consument
  // weet dan dat er méér matchende artikelen waren dan teruggegeven.
  const isVolledig = alleArtikelen.length <= maxResultaten;
  return {
    artikelen: alleArtikelen.slice(0, maxResultaten),
    totaalTreffers,
    isVolledig,
  };
}
