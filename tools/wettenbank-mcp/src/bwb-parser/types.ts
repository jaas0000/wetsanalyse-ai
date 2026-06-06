/**
 * BWB-parser: TypeScript types voor RAW en NORMALIZED datamodellen.
 *
 * DATA MODEL CONTRACT (geldt voor alle nodes):
 *   id       — uniek, stabiel, deterministisch (bijv. "BWBR0024096:artikel:9:lid:1:al:0")
 *   type     — lowercase, snake_case (bijv. "circulaire_divisie", niet "circulaire.divisie")
 *   metadata — genormaliseerde attributen en kopgegevens (camelCase, geen lege velden)
 *   children — structurele child-nodes (altijd array, ook bij 0 kinderen)
 *   content  — ALLEEN bij mixed-content nodes (al, li, entry); anders null
 */

// ── RAW laag ──────────────────────────────────────────────────────────────────

/**
 * Universele node in de RAW-boom.
 * Container-nodes: content = null, children = [...].
 * Mixed-content nodes (al, li, entry): content = [...], children = [].
 */
export interface BwbNode {
  id: string;
  type: string;
  metadata: BwbMetadata;
  children: BwbNode[];
  content: ContentItem[] | null;
}

/** Een item in de content-array van een mixed-content node. */
export type ContentItem = string | InlineNode;

/**
 * Inline element binnen mixed content (intref, extref, nadruk, sup, sub, br).
 * target: @doc-attribuut (JCI-uri of BWB-id).
 * label:  zichtbare linktekst.
 */
export interface InlineNode {
  type: string;
  target?: string;
  label?: string;
  nadrukType?: string;      // "vet" | "cur" — alleen bij type="nadruk"
  content?: ContentItem[];  // voor geneste inline (bijv. nadruk rond een intref)
}

/**
 * Genormaliseerde metadata van een BWB-node.
 * Attributen worden gemapt van XML-attribuutnamen naar camelCase-sleutels.
 * Lege waarden worden NIET opgeslagen.
 */
export interface BwbMetadata {
  bwbId?: string;        // @bwb-id (op <toestand>)
  labelId?: string;      // @bwb-ng-variabel-deel (stabiel artikel-id)
  nr?: string;           // tekst van <nr> in <kop>
  titel?: string;        // tekst van <titel> in <kop>
  label?: string;        // tekst van <label> in <kop> (bijv. "Artikel")
  lidnr?: string;        // tekst van <lidnr>
  linr?: string;         // tekst van <li.nr>
  status?: string;       // @status
  effect?: string;       // @effect
  bron?: string;         // @bron
  verwijzingId?: string; // @doc op intref/extref
  versiedatum?: string;  // @inwerkingtreding op <toestand>
  nadrukType?: string;   // @type op <nadruk>
  colname?: string;      // @colname op <colspec>
  colnum?: string;       // @colnum op <colspec>
  colwidth?: string;     // @colwidth op <colspec>
  cols?: string;         // @cols op <tgroup>
  morerows?: string;     // @morerows op <entry>
  namest?: string;       // @namest op <entry>
  nameend?: string;      // @nameend op <entry>
  align?: string;        // @align op <entry>
  geldig?: {
    van: string | null;  // @geldig-van
    tot: string | null;  // @geldig-tot
  };
}

// ── NORMALIZED laag ───────────────────────────────────────────────────────────
//
// NORMALIZED vereenvoudigt de RAW-boom voor zoekbaarheid en LLM-gebruik.
// Invariant: NORMALIZED mag nooit informatie verliezen t.o.v. RAW.

export type NormalizedNode =
  | NormalizedContainer
  | NormalizedArtikel
  | NormalizedLijst
  | NormalizedTable
  | NormalizedLeaf;

/** Structurele container (hoofdstuk, afdeling, paragraaf, etc.) */
export interface NormalizedContainer {
  id: string;
  type: string;
  metadata: BwbMetadata;
  children: NormalizedNode[];
}

/** Eenvoudige tekst-node (al, enig-artikel zonder leden, etc.) */
export interface NormalizedLeaf {
  id: string;
  type: "al" | "tekst_blok";
  metadata: BwbMetadata;
  tekst: string;          // platte tekst voor zoekbaarheid
  content: ContentItem[]; // gestructureerde content (tekst + inline refs)
}

/** Artikel met genummerde leden (of artikel zonder leden) */
export interface NormalizedArtikel {
  id: string;
  type: "artikel" | "circulaire_divisie";
  metadata: BwbMetadata;
  nr: string;
  titel?: string;
  leden: NormalizedLid[];
}

export interface NormalizedLid {
  id: string;
  metadata: BwbMetadata;
  lidnr: string;          // "" voor artikelen zonder genummerde leden
  tekst: string;          // platte tekst (concatenatie van al-nodes)
  content: ContentItem[]; // gestructureerde content van de al-nodes
  children: NormalizedNode[]; // lijst, tabel, sub-structuren
}

/** Lijst (expliciet/ongemarkeerd) met genormaliseerde items */
export interface NormalizedLijst {
  id: string;
  type: "lijst";
  metadata: BwbMetadata;
  items: NormalizedListItem[];
}

export interface NormalizedListItem {
  id: string;
  metadata: BwbMetadata;
  label: string;          // inhoud van <li.nr>
  tekst: string;          // platte tekst van de <al>-nodes
  content: ContentItem[]; // gestructureerde content
  items: NormalizedListItem[]; // geneste sub-lijst
}

/** CALS-tabel met volledig uitgewerkte rowspan/colspan */
export interface NormalizedTable {
  id: string;
  type: "table";
  metadata: BwbMetadata;
  caption?: string;
  groups: NormalizedTableGroup[];
}

export interface NormalizedTableGroup {
  cols: number;
  colspecs: NormalizedColspec[];
  head: NormalizedTableRow[];
  body: NormalizedTableRow[];
  foot: NormalizedTableRow[];
}

export interface NormalizedColspec {
  name: string;
  colnum?: number;
  colwidth?: string;
}

export interface NormalizedTableRow {
  cells: NormalizedTableCell[];
}

export interface NormalizedTableCell {
  id: string;
  content: ContentItem[];
  tekst: string;
  rowspan: number; // 1 = geen span; afgeleid van @morerows
  colspan: number; // 1 = geen span; afgeleid van @namest/@nameend + colspec
  align?: string;
}

// ── MCP-LITE laag ────────────────────────────────────────────────────────────
//
// MCP-LITE transformeert complexe juridische structuren naar een token-efficiënt,
// Markdown-georiënteerd JSON-formaat voor LLM-gebruik.

export interface McpLiteNode {
  bwbId: string;
  citeertitel: string;
  sectie: string;          // bijv. "Hoofdstuk 1 > Artikel 1" of "Paragraaf 1.1.2 Definities"
  tekst: string;           // platte tekst met Markdown links, lijsten en tabellen
  bronreferentie: string;  // JCI-uri of stabiele BWB-link voor navigatie
  metadata?: Partial<BwbMetadata>; // optionele basis-metadata (status, etc.)
}

/** Eindresultaat van parseBwb() */
export interface ParseResult {
  bwbId: string;
  citeertitel: string;
  versiedatum: string;
  raw: BwbNode;
  normalized: NormalizedNode;
  mcpLite: McpLiteNode[]; // Lijst van content-units voor het LLM
}
