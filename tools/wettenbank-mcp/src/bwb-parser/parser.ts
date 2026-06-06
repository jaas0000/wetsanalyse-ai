/**
 * BWB-parser: XML → RAW BwbNode-boom.
 *
 * Gebruikt @xmldom/xmldom voor echte DOM-traversal zodat mixed content
 * (tekst afgewisseld met inline elementen) correct als ContentItem[] wordt
 * gemodelleerd — iets wat fast-xml-parser niet ondersteunt.
 *
 * Architectuurkeuzes:
 * - <kop> en tekst-metadata-kinderen (nr, lidnr, li.nr) worden naar de
 *   metadata van de parent gehoistd; ze verschijnen NIET als child-node.
 * - Mixed-content elementen (al, li, entry, …) krijgen content=[...], children=[].
 * - Alle andere elementen krijgen children=[...], content=null.
 * - IDs zijn deterministisch: type:nr wanneer een semantisch nummer beschikbaar
 *   is, anders type:index-onder-gelijknamige-siblings.
 */

import { DOMParser } from "@xmldom/xmldom";
import type { BwbNode, BwbMetadata, ContentItem, InlineNode } from "./types.js";

// ── Minimale DOM-interfaces ───────────────────────────────────────────────────
// @xmldom/xmldom heeft zijn eigen Element-type dat botst met het globale
// lib.dom.d.ts Element. We definiëren een minimale interface die precies
// het gedeelte van de DOM beschrijft dat de parser nodig heeft.

interface DomAttr {
  name: string;
  value: string;
}

interface DomNode {
  nodeType: number;
  nodeValue: string | null;
  childNodes: DomNodeList;
}

interface DomNodeList {
  length: number;
  item(index: number): DomNode;
}

interface DomElement extends DomNode {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  attributes: {
    length: number;
    item(index: number): DomAttr | null;
  };
}

// ── Constanten ────────────────────────────────────────────────────────────────

/**
 * Elementen met afgewisseld tekst + inline markup (interleaved model).
 * NB: <li> is een container voor <al>-nodes en staat dus NIET in deze set.
 * <entry> (tabelcel) kan wel direct tekst + inline bevatten.
 */
const MIXED_CONTENT_TAGS = new Set([
  "al", "entry", "notitie", "legaal",
]);

/** Inline elementen die binnen mixed content verschijnen. */
const INLINE_TAGS = new Set([
  "intref", "extref", "nadruk", "sup", "sub", "br", "al.groep",
]);

/**
 * Tags waarvan de tekst als metadata naar de parent gaat.
 * Ze verschijnen NIET als BwbNode child.
 * <kop> wordt apart afgehandeld (bevat meerdere metadata-velden).
 */
const TEXT_METADATA_TAGS = new Set(["nr", "lidnr", "li.nr"]);

/** Tags die volledig als child-node worden overgeslagen. */
const SKIP_AS_CHILD = new Set([...TEXT_METADATA_TAGS, "kop"]);

// ── Attribuut-mapping ─────────────────────────────────────────────────────────

/**
 * Expliciete mapping van XML-attribuutnamen naar metadata-sleutels.
 * null = attribuut overslaan.
 */
const ATTR_REMAP: Record<string, string | null> = {
  "bwb-id":               "bwbId",
  "bwb-ng-variabel-deel": "labelId",
  "inwerkingtreding":     "versiedatum",
  "geldig-van":           "geldigVan",
  "geldig-tot":           "geldigTot",
  "doc":                  "verwijzingId",
  "compleet":             null,
  "scope":                null,
  "xml:space":            null,
};

function mapAttrName(name: string): string | null {
  if (name in ATTR_REMAP) return ATTR_REMAP[name];
  if (name.startsWith("xmlns") || name.startsWith("xsi:")) return null;
  // Generieke kebab-case → camelCase
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ── Hulpfuncties ──────────────────────────────────────────────────────────────

/** Zet tagName om naar lowercase snake_case (circulaire.divisie → circulaire_divisie). */
function normalizeType(tagName: string): string {
  return tagName.toLowerCase().replace(/\./g, "_");
}

/** Bouwt een stabiel, deterministisch ID uit bwbId en padonderdelen. */
function buildId(bwbId: string, path: string[]): string {
  return path.length === 0 ? bwbId : `${bwbId}:${path.join(":")}`;
}

/**
 * Extraheert attribuutwaarden als Record<string, string>.
 * Lege waarden en gemapte null-sleutels worden overgeslagen.
 */
function extractAttributes(el: DomElement): Record<string, string> {
  const result: Record<string, string> = {};
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs.item(i);
    if (!attr?.value) continue;
    const key = mapAttrName(attr.name);
    if (key) result[key] = attr.value;
  }
  return result;
}

/**
 * Extraheert tekst-metadata uit kind-elementen van el:
 * - <kop> → nr, titel, label (plus eventuele kop-attributen)
 * - <lidnr> → lidnr
 * - <li.nr> → linr
 */
function extractTextMetadata(el: DomElement): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);
    if (child.nodeType !== 1) continue;
    const childEl = child as unknown as DomElement;
    const tag = childEl.tagName;

    if (tag === "kop") {
      // kop-attributen meenemen (bijv. @status)
      Object.assign(result, extractAttributes(childEl));
      // kop-kinderen
      for (let j = 0; j < childEl.childNodes.length; j++) {
        const kopChild = childEl.childNodes.item(j);
        if (kopChild.nodeType !== 1) continue;
        const kopChildEl = kopChild as unknown as DomElement;
        const text = kopChildEl.textContent?.trim();
        if (!text) continue;
        switch (kopChildEl.tagName) {
          case "nr":    result["nr"] = text; break;
          case "titel": result["titel"] = text; break;
          case "label": result["label"] = text; break;
        }
      }
    } else if (tag === "lidnr") {
      const text = childEl.textContent?.trim();
      if (text) result["lidnr"] = text;
    } else if (tag === "li.nr") {
      const text = childEl.textContent?.trim();
      if (text) result["linr"] = text;
    }
  }

  return result;
}

/**
 * Bouwt BwbMetadata door XML-attributen en tekst-metadata samen te voegen.
 * Splitst geldigVan/geldigTot naar het geldig-object.
 * Verwijdert lege waarden.
 */
function buildMetadata(
  el: DomElement,
  textExtras: Record<string, string> = {},
): BwbMetadata {
  const attrs = extractAttributes(el);
  // textExtras overschrijft niet attrs — attrs zijn al genormaliseerd
  const combined: Record<string, unknown> = { ...attrs, ...textExtras };

  // geldigVan + geldigTot → geldig: { van, tot }
  const van = combined["geldigVan"] as string | undefined;
  const tot = combined["geldigTot"] as string | undefined;
  if (van !== undefined || tot !== undefined) {
    combined["geldig"] = { van: van ?? null, tot: tot ?? null };
    delete combined["geldigVan"];
    delete combined["geldigTot"];
  }

  // Verwijder lege strings
  for (const key of Object.keys(combined)) {
    const v = combined[key];
    if (v === "" || v == null) delete combined[key];
  }

  return combined as BwbMetadata;
}

/** Geeft het semantische nummer van een element voor ID-opbouw. */
function getSemanticNr(textMeta: Record<string, string>): string | null {
  return textMeta["nr"] || textMeta["lidnr"] || textMeta["linr"] || null;
}

// ── Mixed-content verwerking ──────────────────────────────────────────────────

/** Verwerkt een inline element naar InlineNode. */
function parseInline(el: DomElement, bwbId: string, path: string[]): InlineNode | null {
  const tag = el.tagName;
  const type = normalizeType(tag);

  if (tag === "br") return { type: "br" };

  if (tag === "intref" || tag === "extref") {
    const target = el.getAttribute("doc") || el.getAttribute("reeks") || undefined;
    const label = el.textContent?.trim() || undefined;
    return {
      type,
      ...(target && { target }),
      ...(label && { label }),
    };
  }

  if (tag === "nadruk") {
    const nadrukType = el.getAttribute("type") || undefined;
    const content = parseContentNodes(el, bwbId, path);
    return {
      type,
      ...(nadrukType && { nadrukType }),
      ...(content.length && { content }),
    };
  }

  if (tag === "sup" || tag === "sub") {
    const content = parseContentNodes(el, bwbId, path);
    return { type, content };
  }

  if (tag === "al.groep") {
    const content = parseContentNodes(el, bwbId, path);
    return { type, content };
  }

  // Onbekend inline element: bewaar type en tekst
  const label = el.textContent?.trim() || undefined;
  return { type, ...(label && { label }) };
}

/**
 * Verwerkt de childNodes van een mixed-content element naar ContentItem[].
 * Behoudt de volgorde van tekst en inline elementen (interleaved model).
 */
function parseContentNodes(el: DomElement, bwbId: string, path: string[]): ContentItem[] {
  const items: ContentItem[] = [];

  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);

    if (child.nodeType === 3) {
      // TEXT_NODE — normaliseer witruimte maar behoud spaties
      const text = (child.nodeValue ?? "").replace(/\s+/g, " ");
      if (text.trim()) items.push(text);
    } else if (child.nodeType === 1) {
      const childEl = child as unknown as DomElement;
      const tag = childEl.tagName;

      if (INLINE_TAGS.has(tag)) {
        const inline = parseInline(childEl, bwbId, path);
        if (inline) items.push(inline);
      } else if (tag === "al") {
         // Speciale case: al binnen mixed content (bijv. entry)
         // We parsen dit als een volwaardige BwbNode maar voegen hem toe als inline item
         const alNode = parseElement(childEl, bwbId, path, items.length);
         items.push({
           type: "al",
           content: alNode.content || [],
           label: alNode.metadata.label || undefined
         });
      }
      // Niet-inline elementen in mixed content worden genegeerd op content-niveau
      // (ze zijn geen geldige BWB mixed-content kinderen)
    }
  }

  return items;
}

// ── Recursieve DOM-traversal ──────────────────────────────────────────────────

/**
 * Verwerkt één XML-element naar een BwbNode.
 *
 * @param el           - het te verwerken element
 * @param bwbId        - BWB-id van het document (voor ID-opbouw)
 * @param parentPath   - pad van de parent (string[])
 * @param siblingIndex - index onder gelijknamige siblings (voor ID wanneer geen semanticNr)
 */
export function parseElement(
  el: DomElement,
  bwbId: string,
  parentPath: string[],
  siblingIndex = 0,
): BwbNode {
  const tag = el.tagName;
  const type = normalizeType(tag);

  // Tekst-metadata uit kind-elementen (kop/nr/titel, lidnr, li.nr)
  const textMeta = extractTextMetadata(el);
  const semanticNr = getSemanticNr(textMeta);

  // Bouw het pad voor dit element
  const segment = semanticNr
    ? [type, semanticNr]
    : [type, String(siblingIndex)];
  const thisPath = [...parentPath, ...segment];
  const id = buildId(bwbId, thisPath);

  const metadata = buildMetadata(el, textMeta);

  // Mixed-content: bouw content-array
  if (MIXED_CONTENT_TAGS.has(tag)) {
    const content = parseContentNodes(el, bwbId, thisPath);
    return { id, type, metadata, children: [], content };
  }

  // Container: verwerk kinderen recursief
  const children = parseChildren(el, bwbId, thisPath);
  return { id, type, metadata, children, content: null };
}

/**
 * Verwerkt alle kind-elementen van el als BwbNode[].
 * Slaat TEXT_METADATA_TAGS en kop over (gaan naar parent-metadata).
 * Slaat inline tags over (horen in mixed content, niet als container-kind).
 * Telt per tag-naam voor stabiele index-IDs.
 */
function parseChildren(el: DomElement, bwbId: string, parentPath: string[]): BwbNode[] {
  const children: BwbNode[] = [];
  const counts: Record<string, number> = {};

  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);
    if (child.nodeType !== 1) continue;
    const childEl = child as unknown as DomElement;
    const tag = childEl.tagName;

    if (SKIP_AS_CHILD.has(tag)) continue;
    if (INLINE_TAGS.has(tag)) continue;

    const idx = counts[tag] ?? 0;
    counts[tag] = idx + 1;

    children.push(parseElement(childEl, bwbId, parentPath, idx));
  }

  return children;
}

// ── Publieke API ──────────────────────────────────────────────────────────────

/**
 * Parseert BWB-toestand XML naar een RAW BwbNode-boom.
 *
 * @param xml    - volledige BWB-toestand XML (UTF-8 string)
 * @param bwbId  - BWB-id als fallback (wordt overschreven door @bwb-id in XML)
 */
export function parseBwbXml(xml: string, bwbId: string): BwbNode {
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(xml, "text/xml");
  // doc.documentElement is @xmldom/xmldom's eigen Element-type; cast naar DomElement.
  const root = doc.documentElement as unknown as DomElement | null;

  if (!root) {
    return { id: bwbId, type: "leeg", metadata: { bwbId }, children: [], content: null };
  }

  // Gebruik bwb-id uit het document zelf als dat beschikbaar is
  const actualBwbId = root.getAttribute("bwb-id") || bwbId;

  // Root-node (toestand) krijgt bwbId als ID, niet type:index
  const textMeta = extractTextMetadata(root);
  const metadata = buildMetadata(root, { ...textMeta, bwbId: actualBwbId });
  const type = normalizeType(root.tagName);
  const children = parseChildren(root, actualBwbId, []);

  return { id: actualBwbId, type, metadata, children, content: null };
}
