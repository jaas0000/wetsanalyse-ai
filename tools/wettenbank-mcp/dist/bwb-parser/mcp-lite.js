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
/** BWB-id uit een (ruw) verwijzing-target halen, indien eenduidig aanwezig. */
function extraheerBwbId(target) {
    return target.match(/BWB[RVW]\d+/i)?.[0];
}
/**
 * Verzamelt intref/extref-verwijzingen uit een ContentItem[] (incl. geneste inline,
 * bv. een intref binnen <nadruk>). De volgorde volgt de documentvolgorde.
 */
function verzamelVerwijzingenUitContent(content, bwbId, acc) {
    for (const item of content) {
        if (typeof item === "string")
            continue;
        if ((item.type === "intref" || item.type === "extref") && item.target) {
            const bwbIdDoel = extraheerBwbId(item.target);
            acc.push({
                soort: item.type,
                target: item.target,
                label: item.label || item.target,
                ...(bwbIdDoel ? { bwbIdDoel } : {}),
                // Zonder herleidbaar doel-BWB gaan we uit van een interne verwijzing (intref).
                extern: bwbIdDoel ? bwbIdDoel.toUpperCase() !== bwbId.toUpperCase() : false,
            });
        }
        if (item.content)
            verzamelVerwijzingenUitContent(item.content, bwbId, acc);
    }
}
/**
 * Verzamelt alle uitgaande verwijzingen onder één genormaliseerde node. Spiegelt de
 * render-logica: waar `blocks` aanwezig is, wint die van `content` (anders zouden de
 * al-nodes — die zowel in `content` als in `blocks` zitten — dubbel geteld worden).
 */
function verzamelVerwijzingenUitNode(node, bwbId, acc) {
    if (!node || typeof node !== "object")
        return;
    const n = node;
    // Tabel: loop door alle cellen.
    if (Array.isArray(n.groups)) {
        for (const g of n.groups) {
            for (const rows of [g.head, g.body, g.foot]) {
                for (const row of rows) {
                    for (const cell of row.cells)
                        verzamelVerwijzingenUitContent(cell.content, bwbId, acc);
                }
            }
        }
        return;
    }
    const heeftBlocks = Array.isArray(n.blocks) && n.blocks.length > 0;
    if (heeftBlocks) {
        for (const b of n.blocks)
            verzamelVerwijzingenUitNode(b, bwbId, acc);
    }
    else if (Array.isArray(n.content)) {
        verzamelVerwijzingenUitContent(n.content, bwbId, acc);
    }
    if (Array.isArray(n.leden))
        for (const l of n.leden)
            verzamelVerwijzingenUitNode(l, bwbId, acc);
    if (Array.isArray(n.subdivisies))
        for (const s of n.subdivisies)
            verzamelVerwijzingenUitNode(s, bwbId, acc);
    if (Array.isArray(n.items))
        for (const it of n.items)
            verzamelVerwijzingenUitNode(it, bwbId, acc);
    // children alleen als er geen blocks waren (blocks omvatten de kinderen al).
    if (!heeftBlocks && Array.isArray(n.children)) {
        for (const c of n.children)
            verzamelVerwijzingenUitNode(c, bwbId, acc);
    }
}
/**
 * Hoofdtransformatie: zet een genormaliseerde boom om naar een array van MCP-Lite nodes.
 */
export function transformToMcpLite(root, bwbId, citeertitel, versiedatum = "") {
    const context = { bwbId, citeertitel, path: [], versiedatum };
    const result = [];
    processNode(root, context, result);
    return result;
}
function processNode(node, context, result) {
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
            const art = node;
            const artContext = art.nr ? { ...nextContext, artikelNr: art.nr } : nextContext;
            if (art.leden && art.leden.length > 0) {
                for (const lid of art.leden) {
                    result.push(createMcpLiteNode(lid, artContext));
                }
            }
            else if (!art.subdivisies || art.subdivisies.length === 0) {
                // Artikel zonder leden én zonder sub-divisies: één node van het artikel zelf.
                result.push(createMcpLiteNode(node, artContext));
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
function hasChildren(n) {
    return Array.isArray(n?.children);
}
/**
 * Maakt één MCP-Lite node van een element (lid, artikel, of losse al/lijst).
 */
function createMcpLiteNode(node, context) {
    const { bwbId, citeertitel, path } = context;
    let tekstParts = [];
    const blocks = node.blocks;
    if (Array.isArray(blocks)) {
        // Render de content-blokken in documentvolgorde (tekst, lijst, tabel — interleaved).
        for (const block of blocks) {
            tekstParts.push(renderNodeToMarkdown(block));
        }
    }
    else {
        // Fallback voor nodes zonder blocks (losse lijst/tabel/artikel-zonder-leden).
        // 1. Hoofdtekst (content-array naar Markdown)
        if ("content" in node && node.content && node.content.length > 0) {
            tekstParts.push(renderContent(node.content));
        }
        else if ("tekst" in node && node.tekst) {
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
    }
    else if ("label" in node && node.label) {
        // Check of dit een lijstitem is (heeft 'items' property)
        if ("items" in node) {
            sectie += ` > Item ${node.label}`;
        }
    }
    // 4. Bronreferentie (JCI-uri) — zo specifiek mogelijk: artikel, lid én versie.
    // Het artikelnummer uit de context is de juiste jci-waarde; labelId
    // (bwb-ng-variabel-deel, bv. "/HoofdstukI/Artikel9") is alleen de fallback.
    const labelId = node.metadata?.labelId;
    const artikelDeel = context.artikelNr ?? labelId;
    let bronreferentie = artikelDeel
        ? `jci1.3:c:${bwbId}&artikel=${artikelDeel}`
        : `jci1.3:c:${bwbId}`;
    if (artikelDeel && "lidnr" in node && node.lidnr) {
        bronreferentie += `&lid=${node.lidnr}`;
    }
    if (context.versiedatum) {
        // Zowel &z= als &g= — alleen &g= laat een wetten.overheid.nl-deeplink bovenaan de wet landen.
        bronreferentie += `&z=${context.versiedatum}&g=${context.versiedatum}`;
    }
    // Uitgaande verwijzingen (intref/extref) als zelfstandig gegeven naast de tekst.
    const verwijzingen = [];
    verzamelVerwijzingenUitNode(node, bwbId, verwijzingen);
    return {
        bwbId,
        citeertitel,
        sectie,
        tekst: tekstParts.filter(Boolean).join("\n\n").trim(),
        bronreferentie,
        ...(verwijzingen.length > 0 ? { verwijzingen } : {}),
        metadata: {
            status: node.metadata?.status,
        }
    };
}
/**
 * Rendert ContentItem[] naar Markdown (verwerkt inline refs).
 */
function renderContent(content) {
    const stukken = [];
    let vorigeWasAl = false;
    for (const item of content) {
        let stuk = "";
        let isAl = false;
        if (typeof item === "string") {
            stuk = item;
        }
        else if (item.type === "extref" || item.type === "intref") {
            // Inline links: [label](target). Zonder resolvebaar target alleen de label-tekst
            // (voorkomt "[1.1.](undefined)").
            const label = item.label || item.target || "link";
            stuk = item.target ? `[${label}](${item.target})` : label;
        }
        else if (item.type === "nadruk") {
            const inner = item.content ? renderContent(item.content) : (item.label || "");
            stuk = `**${inner}**`;
        }
        else if (item.type === "al" || item.type === "al_groep") {
            // 'al' als inline container (gebeurt in tabelcellen)
            isAl = item.type === "al";
            stuk = item.content && item.content.length > 0
                ? renderContent(item.content)
                : (item.label || "");
        }
        else if (item.type === "br") {
            // Regelafbreking: als spatie renderen zodat woorden niet aaneenplakken
            // ("regel een<br/>regel twee" → "regel een regel twee").
            stuk = " ";
        }
        else if (item.label) {
            stuk = item.label;
        }
        else if (item.content) {
            stuk = renderContent(item.content);
        }
        // Scheid opeenvolgende al-blokken (bijv. meerdere <al> in één tabelcel) met een
        // spatie, zodat woorden niet aaneenplakken ("regel eenregel twee").
        if (isAl && vorigeWasAl && stuk)
            stukken.push(" ");
        stukken.push(stuk);
        vorigeWasAl = isAl;
    }
    return stukken.join("").replace(/\s+/g, " ").trim();
}
/**
 * Vertaalt een NormalizedNode naar een Markdown string (voor embedding in tekst).
 */
function renderNodeToMarkdown(node) {
    switch (node.type) {
        case "lijst":
            return renderLijstItems(node.items, 0);
        case "table":
            return renderTableToMarkdown(node);
        case "al":
            return renderContent(node.content);
        default:
            return "";
    }
}
/** Voorziet een lijstitem-label van een afsluitende punt als het een nummering is. */
function lijstPrefix(label) {
    let l = label.trim();
    // Alleen een punt toevoegen als het een 'nummering' is (cijfer of letter)
    // en nog geen afsluitend teken heeft. Symbolen zoals - of • krijgen geen punt.
    if (l && /^[a-zA-Z0-9]+$/.test(l))
        l += ".";
    return l ? `${l} ` : "* ";
}
/**
 * Rendert lijstitems recursief met indentatie per niveau, zodat élke diepte
 * (a → 1° → i → …) behouden blijft. Niet-al/lijst-blokken in een item (zoals
 * een tabel) worden ná de itemtekst gerenderd — niets verdwijnt stil.
 */
function renderLijstItems(items, diepte) {
    const indent = "  ".repeat(diepte);
    return items
        .map((li) => {
        const regels = [`${indent}${lijstPrefix(li.label)}${renderContent(li.content)}`];
        if (li.items.length > 0) {
            regels.push(renderLijstItems(li.items, diepte + 1));
        }
        for (const blok of li.blocks ?? []) {
            if (blok.type === "al" || blok.type === "lijst")
                continue; // al in content/items
            const md = renderNodeToMarkdown(blok);
            if (md)
                regels.push(md);
        }
        return regels.join("\n");
    })
        .join("\n");
}
/**
 * Rendert een NormalizedTable naar een GitHub-flavored Markdown tabel.
 */
/** Maakt celtekst veilig voor een Markdown-tabel: pipes escapen, regeleindes → spatie. */
function escapeCelTekst(s) {
    return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}
function renderTableToMarkdown(table) {
    const lines = [];
    for (const group of table.groups) {
        const headRows = group.head;
        const bodyRows = [...group.body, ...group.foot];
        const allRows = [...headRows, ...bodyRows];
        if (allRows.length === 0)
            continue;
        // Aantal kolommen: expliciet (@cols/colspec) of afgeleid uit de breedste rij,
        // rekening houdend met colspan.
        const afgeleid = Math.max(1, ...allRows.map((r) => r.cells.reduce((s, c) => s + Math.max(1, c.colspan || 1), 0)));
        const ncols = group.cols && group.cols > 0 ? group.cols : afgeleid;
        // Plaats cellen in een raster dat colspan én rowspan respecteert, zodat elke
        // rij exact `ncols` kolommen heeft (geen verschuiving). Rowspan-vervolgcellen
        // worden leeg opgevuld.
        const grid = [];
        const bezet = [];
        const zorg = (r) => {
            if (!grid[r])
                grid[r] = new Array(ncols).fill("");
            if (!bezet[r])
                bezet[r] = new Array(ncols).fill(false);
        };
        allRows.forEach((row, r) => {
            zorg(r);
            let c = 0;
            for (const cell of row.cells) {
                while (c < ncols && bezet[r][c])
                    c++;
                if (c >= ncols)
                    break;
                const tekst = escapeCelTekst(renderContent(cell.content));
                const cs = Math.max(1, cell.colspan || 1);
                const rs = Math.max(1, cell.rowspan || 1);
                for (let dr = 0; dr < rs; dr++) {
                    for (let dc = 0; dc < cs; dc++) {
                        if (c + dc >= ncols)
                            continue;
                        zorg(r + dr);
                        bezet[r + dr][c + dc] = true;
                        grid[r + dr][c + dc] = dr === 0 && dc === 0 ? tekst : "";
                    }
                }
                c += cs;
            }
        });
        if (grid.length === 0)
            continue;
        const renderRij = (cellen) => `| ${cellen.map((x) => (x === "" ? " " : x)).join(" | ")} |`;
        // Headerrij = eerste rasterrij (expliciete <thead> óf, bij ontbreken, de eerste
        // body-rij). De datarijen beginnen daarna; de eerste rij wordt dus niet gedupliceerd.
        lines.push(renderRij(grid[0]));
        lines.push(`| ${new Array(ncols).fill("---").join(" | ")} |`);
        for (let i = 1; i < grid.length; i++)
            lines.push(renderRij(grid[i]));
    }
    return lines.join("\n");
}
