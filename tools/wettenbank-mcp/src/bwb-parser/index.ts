/**
 * Publieke API van de BWB-parser.
 *
 * parseBwb(xml, bwbId) → ParseResult met zowel RAW als NORMALIZED output.
 *
 * Gebruik:
 *   import { parseBwb } from "./bwb-parser/index.js";
 *   const result = parseBwb(rawXml, "BWBR0024096");
 *   result.raw        // volledige RAW BwbNode-boom
 *   result.normalized // NORMALIZED NormalizedNode-boom
 */

export { parseBwbXml, parseElement } from "./parser.js";
export { normalizeNode, extractPlainText } from "./normalizer.js";
export { transformToMcpLite } from "./mcp-lite.js";
export type {
  BwbNode,
  BwbMetadata,
  ContentItem,
  InlineNode,
  ParseResult,
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
  McpLiteNode,
} from "./types.js";

import { parseBwbXml } from "./parser.js";
import { normalizeNode } from "./normalizer.js";
import { transformToMcpLite } from "./mcp-lite.js";
import type { ParseResult } from "./types.js";

/**
 * Hoofdentry: parseert BWB-toestand XML naar RAW + NORMALIZED + MCP-LITE.
 *
 * @param xml         - volledige BWB-toestand XML
 * @param bwbId       - BWB-id als fallback (wordt overschreven door @bwb-id in XML)
 * @param citeertitel - citeertitel van de regeling (uit SRU of DOM)
 * @param versiedatum - inwerkingtredingsdatum (uit SRU of DOM)
 */
export function parseBwb(
  xml: string,
  bwbId: string,
  citeertitel = "",
  versiedatum = "",
): ParseResult {
  const raw = parseBwbXml(xml, bwbId);
  const normalized = normalizeNode(raw);
  
  const finalBwbId = raw.metadata.bwbId ?? bwbId;
  const mcpLite = transformToMcpLite(normalized, finalBwbId, citeertitel);

  return {
    bwbId: finalBwbId,
    citeertitel,
    versiedatum,
    raw,
    normalized,
    mcpLite,
  };
}
