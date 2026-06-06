/**
 * MCP-LITE: Transformatie van NORMALIZED naar token-efficiënte Markdown-JSON.
 *
 * Volgt de "Juridische Data Transformator" principes:
 * 1. Elimineer redundantie
 * 2. Tekst boven Structuur (Markdown)
 * 3. Inline Links ([label](target))
 * 4. Flatten Tabellen & Lijsten naar Markdown
 * 5. Contextbehoud (citeertitel, sectie)
 */

import type {
  NormalizedNode,
  McpLiteNode,
  ContentItem,
  NormalizedLid,
  NormalizedListItem,
  NormalizedTable,
  BwbMetadata,
  NormalizedArtikel,
  NormalizedLijst,
  NormalizedLeaf,
} from "./types.js";

interface TransformContext {
  bwbId: string;
  citeertitel: string;
  path: string[];
}

/**
 * Hoofdtransformatie: zet een genormaliseerde boom om naar een array van MCP-Lite nodes.
 */
export function transformToMcpLite(
  root: NormalizedNode,
  bwbId: string,
  citeertitel: string
): McpLiteNode[] {
  const context: TransformContext = { bwbId, citeertitel, path: [] };
  const result: McpLiteNode[] = [];
  
  processNode(root, context, result);
  
  return result;
}

function processNode(
  node: NormalizedNode,
  context: TransformContext,
  result: McpLiteNode[]
): void {
  const label = node.metadata.label || "";
  const nr = node.metadata.nr || node.metadata.lidnr || node.metadata.linr || "";
  const titel = node.metadata.titel || "";
  
  // Ontdubbel label en nr (voorkom "1.1.1 1.1.1")
  const labelPart = (label && label !== nr) ? label : "";
  const currentLevel = [labelPart, nr, titel].filter(Boolean).join(" ");
  
  const newPath = currentLevel ? [...context.path, currentLevel] : context.path;
  const nextContext = { ...context, path: newPath };

  switch (node.type) {
    case "artikel":
    case "circulaire_divisie":
      // Artikelen zijn de primaire 'content-units'
      const art = node as NormalizedArtikel;
      if (art.leden && art.leden.length > 0) {
        for (const lid of art.leden) {
          result.push(createMcpLiteNode(lid, nextContext));
        }
      } else {
        // Artikel zonder leden: we maken één node van het artikel zelf
        // createMcpLiteNode pakt automatisch alle 'children' mee.
        result.push(createMcpLiteNode(node, nextContext));
      }
      break;

    case "lijst":
    case "table":
    case "al":
      // Losse elementen (buiten een artikel/lid context)
      result.push(createMcpLiteNode(node, nextContext));
      break;

    default:
      // Containers (hoofdstuk, paragraaf): recursief doorzoeken
      if ("children" in node) {
        for (const child of node.children) {
          processNode(child, nextContext, result);
        }
      }
  }
}

function hasChildren(n: unknown): n is { children: NormalizedNode[] } {
  return Array.isArray((n as Record<string, unknown>)?.children);
}

/**
 * Maakt één MCP-Lite node van een element (lid, artikel, of losse al/lijst).
 */
function createMcpLiteNode(
  node: NormalizedLid | NormalizedNode | NormalizedListItem,
  context: TransformContext
): McpLiteNode {
  const { bwbId, citeertitel, path } = context;
  
  let tekstParts: string[] = [];
  
  // 1. Hoofdtekst (content-array naar Markdown)
  if ("content" in node && node.content && node.content.length > 0) {
    tekstParts.push(renderContent(node.content));
  } else if ("tekst" in node && node.tekst) {
    tekstParts.push(node.tekst);
  }

  // 2. Kinderen (lijsten, tabellen) naar Markdown flattenen
  if (hasChildren(node)) {
    for (const child of node.children) {
      tekstParts.push(renderNodeToMarkdown(child));
    }
  }

  // 3. Sectie-pad (bijv. "Hoofdstuk 1 > Artikel 1")
  let sectie = path.join(" > ");
  if ("lidnr" in node && node.lidnr) {
    sectie += ` > Lid ${node.lidnr}`;
  } else if ("label" in node && node.label) {
    // Check of dit een lijstitem is (heeft 'items' property)
    if ("items" in node) {
       sectie += ` > Item ${node.label}`;
    }
  }

  // 4. Bronreferentie (JCI-uri)
  const labelId = node.metadata?.labelId;
  const bronreferentie = labelId 
    ? `jci1.3:c:${bwbId}&artikel=${labelId}` 
    : `jci1.3:c:${bwbId}`;

  return {
    bwbId,
    citeertitel,
    sectie,
    tekst: tekstParts.filter(Boolean).join("\n\n").trim(),
    bronreferentie,
    metadata: {
      status: node.metadata?.status,
    } as Partial<BwbMetadata>
  };
}

/**
 * Rendert ContentItem[] naar Markdown (verwerkt inline refs).
 */
function renderContent(content: ContentItem[]): string {
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      
      // Inline links: [label](target)
      if (item.type === "extref" || item.type === "intref") {
        const label = item.label || item.target || "link";
        return `[${label}](${item.target})`;
      }
      
      // Nadruk
      if (item.type === "nadruk") {
        const inner = item.content ? renderContent(item.content) : (item.label || "");
        return `**${inner}**`;
      }

      // 'al' als inline container (gebeurt in tabelcellen)
      if (item.type === "al" || item.type === "al_groep") {
        // BELANGRIJK: Gebruik item.content als die er is, anders item.label
        if (item.content && item.content.length > 0) {
          return renderContent(item.content);
        }
        return item.label || "";
      }
      
      // Fallback
      if (item.label) return item.label;
      if (item.content) return renderContent(item.content);
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vertaalt een NormalizedNode naar een Markdown string (voor embedding in tekst).
 */
function renderNodeToMarkdown(node: NormalizedNode): string {
  switch (node.type) {
    case "lijst":
      const lijst = node as NormalizedLijst;
      return lijst.items
        .map((li: NormalizedListItem) => {
          let label = li.label.trim();
          // Alleen een punt toevoegen als het een 'nummering' is (cijfer of letter)
          // en nog geen afsluitend teken heeft. Symbolen zoals - of • krijgen geen punt.
          if (label && /^[a-zA-Z0-9]+$/.test(label)) {
            label += ".";
          }
          const prefix = label ? `${label} ` : "* ";
          let text = renderContent(li.content);
          if (li.items.length > 0) {
            // Geneste lijst met indentatie
            const nested = li.items.map((sub: NormalizedListItem) => {
              let subLabel = sub.label.trim();
              if (subLabel && /^[a-zA-Z0-9]+$/.test(subLabel)) {
                subLabel += ".";
              }
              const subPrefix = subLabel ? `${subLabel} ` : "* ";
              return `  ${subPrefix}${renderContent(sub.content)}`;
            }).join("\n");
            text += "\n" + nested;
          }
          return `${prefix}${text}`;
        })
        .join("\n");

    case "table":
      return renderTableToMarkdown(node as NormalizedTable);

    case "al":
      return renderContent((node as NormalizedLeaf).content);

    default:
      return "";
  }
}

/**
 * Rendert een NormalizedTable naar een GitHub-flavored Markdown tabel.
 */
function renderTableToMarkdown(table: NormalizedTable): string {
  const rows: string[] = [];
  
  for (const group of table.groups) {
    // We combineren head en body voor de Markdown tabel
    const allRows = [...group.head, ...group.body];
    if (allRows.length === 0) continue;

    // Header rij
    const firstRow = allRows[0];
    if (!firstRow || !firstRow.cells || firstRow.cells.length === 0) continue;

    rows.push(`| ${firstRow.cells.map(c => renderContent(c.content)).join(" | ")} |`);
    
    // Separator rij
    rows.push(`| ${firstRow.cells.map(() => "---").join(" | ")} |`);

    // Data rijen (vanaf index 1 als er een header was, anders 0)
    const dataRows = group.head.length > 0 ? allRows.slice(1) : allRows;
    for (const row of dataRows) {
      rows.push(`| ${row.cells.map(c => renderContent(c.content)).join(" | ")} |`);
    }
  }

  return rows.join("\n");
}
