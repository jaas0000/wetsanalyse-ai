/**
 * BWB-normalizer: RAW BwbNode-boom → NORMALIZED NormalizedNode-boom.
 *
 * Transformaties:
 * - artikel / circulaire.divisie → NormalizedArtikel met NormalizedLid[]
 * - lijst → NormalizedLijst met NormalizedListItem[] (incl. geneste sub-lijsten)
 * - table (CALS) → NormalizedTable met rowspan/colspan uitgerekend
 * - overig → NormalizedContainer of NormalizedLeaf
 *
 * Invariant: de NORMALIZED-laag mag nooit informatie verliezen t.o.v. RAW.
 */

import { log } from "../logger.js";
import type {
  BwbNode,
  BwbMetadata,
  ContentItem,
  NormalizedNode,
  NormalizedContainer,
  NormalizedArtikel,
  NormalizedLid,
  NormalizedLijst,
  NormalizedListItem,
  NormalizedTable,
  NormalizedTableGroup,
  NormalizedColspec,
  NormalizedTableRow,
  NormalizedTableCell,
  NormalizedLeaf,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parseert een (optionele) string naar een geheel getal. Niet-numerieke of ontbrekende
 * waarden geven de fallback terug i.p.v. `NaN` — `NaN` zou de tabel-rasterberekening
 * (cols/colnum/rowspan) corrumperen.
 */
function parseIntOf<T>(waarde: string | undefined, fallback: T): number | T {
  if (waarde === undefined) return fallback;
  const n = parseInt(waarde, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ── Tekst-extractie ───────────────────────────────────────────────────────────

/**
 * Extraheert platte tekst uit een ContentItem[].
 * Inline nodes: label-tekst of recursief content.
 */
export function extractPlainText(content: ContentItem[]): string {
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item.label) return item.label;
      if (item.content) return extractPlainText(item.content);
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

// Bekende types die terecht als container worden behandeld. Alleen types die hier
// NIET in staan triggeren een waarschuwing — dit vangt nieuwe XML-tags op die
// overheid.nl introduceert bij een wetswijziging zonder dat er data verloren gaat.
const BEKENDE_CONTAINER_TYPES = new Set([
  // Structurele containers (BWB-toestand/2016-1)
  // Let op: normalizeType() vervangt alleen punten door underscores, geen koppeltekens.
  "toestand", "wettekst", "wetgeving", "regeling", "regeling_tekst",
  "circulaire", "circulaire-tekst",
  "boek", "deel", "hoofdstuk", "titel", "afdeling", "paragraaf", "subparagraaf",
  "bijlage", "divisie",
  // Lid/inhoudscontainers
  "kop", "lid", "tekst", "li",
  // Parser-interne types
  "leeg",
]);

/** Dispatch op node-type naar de juiste normalizer-functie. */
export function normalizeNode(node: BwbNode): NormalizedNode {
  switch (node.type) {
    case "artikel":
    case "circulaire_divisie":
      return normalizeArtikel(node);
    case "lijst":
      return normalizeLijst(node);
    case "table":
      return normalizeTable(node);
    case "al":
      return normalizeLeaf(node);
    default:
      if (!BEKENDE_CONTAINER_TYPES.has(node.type)) {
        log("warn", "functioneel", "onbekend BWB-tag type — valt terug op container", {
          type: node.type,
        });
      }
      return normalizeContainer(node);
  }
}

// ── Container ─────────────────────────────────────────────────────────────────

function normalizeContainer(node: BwbNode): NormalizedContainer {
  return {
    id: node.id,
    type: node.type,
    metadata: node.metadata,
    children: node.children.map(normalizeNode),
  };
}

// ── Leaf (al, enkelvoudig tekst-blok) ────────────────────────────────────────

function normalizeLeaf(node: BwbNode): NormalizedLeaf {
  const content = node.content ?? [];
  return {
    id: node.id,
    type: "al",
    metadata: node.metadata,
    tekst: extractPlainText(content),
    content,
  };
}

// ── Artikel ───────────────────────────────────────────────────────────────────

/**
 * Normaliseert een <artikel> of <circulaire.divisie> naar NormalizedArtikel.
 *
 * Drie gevallen:
 * 1. Artikel met <lid>-kinderen → één NormalizedLid per lid.
 * 2. Artikel met directe <al>-kinderen (geen lid) → één NormalizedLid met lidnr "".
 * 3. circulaire.divisie met <tekst>-blok → één NormalizedLid met lidnr "".
 */
function normalizeArtikel(node: BwbNode): NormalizedArtikel {
  const nr = node.metadata.nr ?? "";
  const titel = node.metadata.titel;
  const leden: NormalizedLid[] = [];
  let subdivisies: NormalizedArtikel[] | undefined;

  if (node.type === "circulaire_divisie") {
    // Leidraad-structuur: circulaire.divisie → kop, tekst?, lijst*, circulaire.divisie*.
    // Eigen content (alles behalve kop en sub-divisies) in documentvolgorde; <tekst>
    // wordt uitgepakt zodat al/lijst/tabel op één niveau staan.
    const contentChildren: BwbNode[] = [];
    for (const child of node.children) {
      if (child.type === "kop" || child.type === "circulaire_divisie") continue;
      if (child.type === "tekst") contentChildren.push(...child.children);
      else contentChildren.push(child);
    }
    if (contentChildren.length > 0) {
      leden.push(buildLid(`${node.id}:lid:0`, "", contentChildren, node.metadata));
    }

    // Sub-divisies recursief — behoudt nesting, kop én tekst op elk niveau (geen verlies).
    const subs = node.children.filter((c) => c.type === "circulaire_divisie");
    if (subs.length > 0) subdivisies = subs.map((c) => normalizeArtikel(c));
  } else {
    // Regulier artikel
    const lidNodes = node.children.filter((c) => c.type === "lid");

    if (lidNodes.length > 0) {
      for (const lid of lidNodes) {
        const lidnr = lid.metadata.lidnr ?? "";
        leden.push(buildLid(lid.id, lidnr, lid.children, lid.metadata));
      }
    } else {
      // Artikel zonder genummerde leden: directe content-kinderen
      const contentChildren = node.children.filter((c) => c.type !== "kop");
      if (contentChildren.length > 0) {
        leden.push(buildLid(`${node.id}:lid:0`, "", contentChildren, node.metadata));
      }
    }
  }

  return {
    id: node.id,
    type: node.type as "artikel" | "circulaire_divisie",
    metadata: node.metadata,
    nr,
    ...(titel && { titel }),
    leden,
    ...(subdivisies && { subdivisies }),
  };
}

/**
 * Bouwt een NormalizedLid uit de content-kinderen van een lid/artikel, in
 * documentvolgorde. `blocks` behoudt die volgorde (al, lijst, tabel, …) zodat
 * de interleave tekst → tabel/lijst → tekst niet wordt herordend; `content`/`tekst`
 * blijven de platte concatenatie van uitsluitend de al-blokken (voor zoekbaarheid).
 */
function buildLid(
  id: string,
  lidnr: string,
  contentChildren: BwbNode[],
  metadata: BwbMetadata,
): NormalizedLid {
  const blocks: NormalizedNode[] = contentChildren.map(normalizeNode);

  const alLeaves = blocks.filter((b): b is NormalizedLeaf => b.type === "al");
  const content: ContentItem[] = alLeaves.flatMap((a) => a.content);
  const tekst = extractPlainText(content);

  // children = niet-al blokken (lijst, tabel, sub-structuren) — backward-compat.
  const children: NormalizedNode[] = blocks.filter((b) => b.type !== "al");

  return { id, lidnr, tekst, content, children, blocks, metadata };
}

// ── Lijst ─────────────────────────────────────────────────────────────────────

function normalizeLijst(node: BwbNode): NormalizedLijst {
  const items = node.children
    .filter((c) => c.type === "li")
    .map((li) => normalizeLi(li));

  return {
    id: node.id,
    type: "lijst",
    metadata: node.metadata,
    items,
  };
}

function normalizeLi(li: BwbNode): NormalizedListItem {
  const label = li.metadata.linr ?? "";
  const alNodes = li.children.filter((c) => c.type === "al");
  const content: ContentItem[] = alNodes.flatMap((al) => al.content ?? []);
  const tekst = extractPlainText(content);

  // Geneste sub-lijsten
  const items: NormalizedListItem[] = li.children
    .filter((c) => c.type === "lijst")
    .flatMap((l) => normalizeLijst(l).items);

  return { id: li.id, label, tekst, content, items, metadata: li.metadata };
}

// ── CALS Tabel ────────────────────────────────────────────────────────────────

function normalizeTable(node: BwbNode): NormalizedTable {
  // Optionele tabel-titel (<title> of eerste tekst-child)
  const titleNode = node.children.find(
    (c) => c.type === "title" || c.type === "caption",
  );
  const caption = titleNode?.content
    ? extractPlainText(titleNode.content)
    : undefined;

  const groups = node.children
    .filter((c) => c.type === "tgroup")
    .map((tg) => normalizeTgroup(tg));

  return {
    id: node.id,
    type: "table",
    metadata: node.metadata,
    ...(caption && { caption }),
    groups,
  };
}

function normalizeTgroup(tgroup: BwbNode): NormalizedTableGroup {
  // Colspecs ophalen en naam→index-map bouwen voor colspan-berekening
  const colspecs: NormalizedColspec[] = tgroup.children
    .filter((c) => c.type === "colspec")
    .map((cs, idx) => ({
      name: (cs.metadata.colname as string | undefined) ?? `col${idx}`,
      colnum: parseIntOf(cs.metadata.colnum, undefined),
      colwidth: cs.metadata.colwidth,
    }));

  const colNameToIdx = new Map<string, number>(
    colspecs.map((cs, idx) => [cs.name, idx]),
  );

  const cols = parseIntOf(tgroup.metadata.cols, colspecs.length || 1);

  const headNode = tgroup.children.find((c) => c.type === "thead");
  const bodyNode = tgroup.children.find((c) => c.type === "tbody");
  const footNode = tgroup.children.find((c) => c.type === "tfoot");

  return {
    cols,
    colspecs,
    head: headNode ? normalizeRowGroup(headNode, colNameToIdx) : [],
    body: bodyNode ? normalizeRowGroup(bodyNode, colNameToIdx) : [],
    foot: footNode ? normalizeRowGroup(footNode, colNameToIdx) : [],
  };
}

function normalizeRowGroup(
  node: BwbNode,
  colNameToIdx: Map<string, number>,
): NormalizedTableRow[] {
  return node.children
    .filter((c) => c.type === "row")
    .map((row) => normalizeRow(row, colNameToIdx));
}

function normalizeRow(
  row: BwbNode,
  colNameToIdx: Map<string, number>,
): NormalizedTableRow {
  const cells = row.children
    .filter((c) => c.type === "entry")
    .map((entry) => normalizeEntry(entry, colNameToIdx));
  return { cells };
}

function normalizeEntry(
  entry: BwbNode,
  colNameToIdx: Map<string, number>,
): NormalizedTableCell {
  const content = entry.content ?? [];
  const tekst = extractPlainText(content);

  // rowspan: @morerows + 1 (CALS-conventie: morerows = extra rijen na de eigen rij)
  const morerows = parseIntOf(entry.metadata.morerows, 0);
  const rowspan = morerows + 1;

  // colspan: bereken uit @namest/@nameend via de colspec-index-map
  let colspan = 1;
  const namest = entry.metadata.namest;
  const nameend = entry.metadata.nameend;
  if (
    namest && nameend &&
    colNameToIdx.has(namest) &&
    colNameToIdx.has(nameend)
  ) {
    const startIdx = colNameToIdx.get(namest)!;
    const endIdx = colNameToIdx.get(nameend)!;
    colspan = Math.max(1, endIdx - startIdx + 1);
  }

  return {
    id: entry.id,
    content,
    tekst,
    rowspan,
    colspan,
    ...(entry.metadata.align && { align: entry.metadata.align }),
  };
}
