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
    case "circulaire_divisie": {
      // Artikelen zijn de primaire 'content-units'
      const art = node as NormalizedArtikel;
      if (art.leden && art.leden.length > 0) {
        for (const lid of art.leden) {
          result.push(createMcpLiteNode(lid, nextContext));
        }
      } else if (!art.subdivisies || art.subdivisies.length === 0) {
        // Artikel zonder leden én zonder sub-divisies: één node van het artikel zelf.
        result.push(createMcpLiteNode(node, nextContext));
      }
      // Geneste circulaire.divisie-subsecties: recursief, zodat elk dieper niveau
      // zijn eigen node met volledig pad én tekst krijgt (geen verlies, geen platslaan).
      if (art.subdivisies) {
        for (const sub of art.subdivisies) {
          processNode(sub, nextContext, result);
        }
      }
      break;
    }

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

  const blocks = (node as NormalizedLid).blocks;
  if (Array.isArray(blocks)) {
    // Render de content-blokken in documentvolgorde (tekst, lijst, tabel — interleaved).
    for (const block of blocks) {
      tekstParts.push(renderNodeToMarkdown(block));
    }
  } else {
    // Fallback voor nodes zonder blocks (losse lijst/tabel/artikel-zonder-leden).
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
  const stukken: string[] = [];
  let vorigeWasAl = false;

  for (const item of content) {
    let stuk = "";
    let isAl = false;

    if (typeof item === "string") {
      stuk = item;
    } else if (item.type === "extref" || item.type === "intref") {
      // Inline links: [label](target). Zonder resolvebaar target alleen de label-tekst
      // (voorkomt "[1.1.](undefined)").
      const label = item.label || item.target || "link";
      stuk = item.target ? `[${label}](${item.target})` : label;
    } else if (item.type === "nadruk") {
      const inner = item.content ? renderContent(item.content) : (item.label || "");
      stuk = `**${inner}**`;
    } else if (item.type === "al" || item.type === "al_groep") {
      // 'al' als inline container (gebeurt in tabelcellen)
      isAl = item.type === "al";
      stuk = item.content && item.content.length > 0
        ? renderContent(item.content)
        : (item.label || "");
    } else if (item.label) {
      stuk = item.label;
    } else if (item.content) {
      stuk = renderContent(item.content);
    }

    // Scheid opeenvolgende al-blokken (bijv. meerdere <al> in één tabelcel) met een
    // spatie, zodat woorden niet aaneenplakken ("regel eenregel twee").
    if (isAl && vorigeWasAl && stuk) stukken.push(" ");
    stukken.push(stuk);
    vorigeWasAl = isAl;
  }

  return stukken.join("").replace(/\s+/g, " ").trim();
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
/** Maakt celtekst veilig voor een Markdown-tabel: pipes escapen, regeleindes → spatie. */
function escapeCelTekst(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function renderTableToMarkdown(table: NormalizedTable): string {
  const lines: string[] = [];

  for (const group of table.groups) {
    const headRows = group.head;
    const bodyRows = [...group.body, ...group.foot];
    const allRows = [...headRows, ...bodyRows];
    if (allRows.length === 0) continue;

    // Aantal kolommen: expliciet (@cols/colspec) of afgeleid uit de breedste rij,
    // rekening houdend met colspan.
    const afgeleid = Math.max(
      1,
      ...allRows.map((r) =>
        r.cells.reduce((s, c) => s + Math.max(1, c.colspan || 1), 0),
      ),
    );
    const ncols = group.cols && group.cols > 0 ? group.cols : afgeleid;

    // Plaats cellen in een raster dat colspan én rowspan respecteert, zodat elke
    // rij exact `ncols` kolommen heeft (geen verschuiving). Rowspan-vervolgcellen
    // worden leeg opgevuld.
    const grid: string[][] = [];
    const bezet: boolean[][] = [];
    const zorg = (r: number) => {
      if (!grid[r]) grid[r] = new Array(ncols).fill("");
      if (!bezet[r]) bezet[r] = new Array(ncols).fill(false);
    };

    allRows.forEach((row, r) => {
      zorg(r);
      let c = 0;
      for (const cell of row.cells) {
        while (c < ncols && bezet[r][c]) c++;
        if (c >= ncols) break;
        const tekst = escapeCelTekst(renderContent(cell.content));
        const cs = Math.max(1, cell.colspan || 1);
        const rs = Math.max(1, cell.rowspan || 1);
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (c + dc >= ncols) continue;
            zorg(r + dr);
            bezet[r + dr][c + dc] = true;
            grid[r + dr][c + dc] = dr === 0 && dc === 0 ? tekst : "";
          }
        }
        c += cs;
      }
    });

    if (grid.length === 0) continue;

    const renderRij = (cellen: string[]) =>
      `| ${cellen.map((x) => (x === "" ? " " : x)).join(" | ")} |`;

    // Headerrij = eerste rasterrij (expliciete <thead> óf, bij ontbreken, de eerste
    // body-rij). De datarijen beginnen daarna; de eerste rij wordt dus niet gedupliceerd.
    lines.push(renderRij(grid[0]));
    lines.push(`| ${new Array(ncols).fill("---").join(" | ")} |`);
    for (let i = 1; i < grid.length; i++) lines.push(renderRij(grid[i]));
  }

  return lines.join("\n");
}
