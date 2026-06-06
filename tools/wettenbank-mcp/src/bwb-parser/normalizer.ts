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

  if (node.type === "circulaire_divisie") {
    // Leidraad-structuur: circulaire.divisie → kop, tekst?, lijst*, circulaire.divisie*
    const alNodes: BwbNode[] = [];
    const overige: BwbNode[] = [];

    // Verzamel alles wat GEEN sub-divisie is als de 'hoofdcontent' van dit artikel
    for (const child of node.children) {
      if (child.type === "tekst") {
        // Tekst blok bevat meestal de al-nodes
        alNodes.push(...child.children.filter(c => c.type === "al"));
        overige.push(...child.children.filter(c => c.type !== "al"));
      } else if (child.type === "al") {
        alNodes.push(child);
      } else if (child.type === "circulaire_divisie") {
        // Sub-divisies worden later apart als 'leden' toegevoegd
      } else if (child.type !== "kop") {
        overige.push(child);
      }
    }

    if (alNodes.length > 0 || overige.length > 0) {
      leden.push(buildLid(`${node.id}:lid:0`, "", alNodes, overige, node.metadata));
    }

    // Sub-divisies als aparte leden (voor geneste divisies)
    const subDivisies = node.children.filter((c) => c.type === "circulaire_divisie");
    for (const sub of subDivisies) {
      const subAl: BwbNode[] = [];
      const subOverige: BwbNode[] = [];
      
      for (const c of sub.children) {
        if (c.type === "tekst") {
          subAl.push(...c.children.filter(gc => gc.type === "al"));
          subOverige.push(...c.children.filter(gc => gc.type !== "al"));
        } else if (c.type === "al") {
          subAl.push(c);
        } else if (c.type !== "kop" && c.type !== "circulaire_divisie") {
          subOverige.push(c);
        }
      }
      
      leden.push(buildLid(
        `${node.id}:sub:${sub.metadata.nr ?? leden.length}`,
        sub.metadata.nr ?? "",
        subAl,
        subOverige,
        sub.metadata,
      ));
    }
  } else {
    // Regulier artikel
    const lidNodes = node.children.filter((c) => c.type === "lid");

    if (lidNodes.length > 0) {
      for (const lid of lidNodes) {
        const lidnr = lid.metadata.lidnr ?? "";
        const alNodes = lid.children.filter((c) => c.type === "al");
        const overige = lid.children.filter((c) => c.type !== "al");
        leden.push(buildLid(lid.id, lidnr, alNodes, overige, lid.metadata));
      }
    } else {
      // Artikel zonder genummerde leden: directe al-nodes
      const alNodes = node.children.filter((c) => c.type === "al");
      const overige = node.children.filter((c) => c.type !== "al");
      if (alNodes.length > 0 || overige.length > 0) {
        leden.push(buildLid(`${node.id}:lid:0`, "", alNodes, overige, node.metadata));
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
  };
}

/**
 * Bouwt een NormalizedLid uit al-nodes (content) en overige kinderen (children).
 */
function buildLid(
  id: string,
  lidnr: string,
  alNodes: BwbNode[],
  overigeChildren: BwbNode[],
  metadata: BwbMetadata,
): NormalizedLid {
  // Concateneer alle content van de al-nodes
  const content: ContentItem[] = alNodes.flatMap((al) => al.content ?? []);
  const tekst = extractPlainText(content);

  // Overige kinderen (lijst, tabel, sub-structuren) recursief normaliseren
  const children: NormalizedNode[] = overigeChildren.map(normalizeNode);

  return { id, lidnr, tekst, content, children, metadata };
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
      colnum: cs.metadata.colnum ? parseInt(cs.metadata.colnum, 10) : undefined,
      colwidth: cs.metadata.colwidth,
    }));

  const colNameToIdx = new Map<string, number>(
    colspecs.map((cs, idx) => [cs.name, idx]),
  );

  const cols = tgroup.metadata.cols
    ? parseInt(tgroup.metadata.cols, 10)
    : colspecs.length || 1;

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
  const morerows = entry.metadata.morerows ? parseInt(entry.metadata.morerows) : 0;
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
