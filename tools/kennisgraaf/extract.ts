/**
 * Extraheert alle JCI-verwijzingen uit één of meerdere wetten via de wettenbank MCP
 * en schrijft een graph.json die door index.html als 3D-kennisgraaf wordt getoond.
 *
 * Gebruik: WETTENBANK_TOKEN=<token> npx tsx extract.ts [BWBR-ID ...]
 * Voorbeeld (1 wet):  WETTENBANK_TOKEN=… npx tsx extract.ts BWBR0004770
 * Voorbeeld (2 wetten): WETTENBANK_TOKEN=… npx tsx extract.ts BWBR0004770 BWBR0024096
 * Zonder BWB-ID: zoekt op "Invorderingswet 1990".
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ── Configuratie ──────────────────────────────────────────────────────────────

const MCP_URL = "https://wettenbank-mcp.ipalm.nl/mcp";
const TOKEN = process.env.WETTENBANK_TOKEN;
const CONCURRENCY = 1;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 3000;
const REQUEST_DELAY_MS = 400;

// Alle BWB-IDs opgegeven als CLI-argumenten
const CLI_BWB_IDS: string[] = process.argv
  .slice(2)
  .map((a) => a.match(/^BWBR\d+$/i)?.[0]?.toUpperCase())
  .filter((id): id is string => Boolean(id));

if (!TOKEN) {
  console.error("Fout: WETTENBANK_TOKEN is niet ingesteld.");
  console.error("Gebruik: WETTENBANK_TOKEN=<token> npx tsx extract.ts [BWBR-ID ...]");
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Regeling {
  bwbId: string;
  titel: string;
  type: string;
}

interface ZoekOutput {
  totaal: number;
  isVolledig: boolean;
  regelingen: Regeling[];
}

interface StructuurNode {
  type: string;
  nr: string;
  titel?: string;
  artikelen?: string[];
  secties?: StructuurNode[];
  ingekort?: boolean;
}

interface StructuurOutput {
  bwbId: string;
  citeertitel: string;
  versiedatum: string;
  structuur: StructuurNode[];
}

interface Verwijzing {
  soort: "intref" | "extref";
  target: string;
  label: string;
  bwbIdDoel?: string;
  extern: boolean;
}

interface Lid {
  lid: string;
  tekst: string;
  bronreferentie: string;
  verwijzingen?: Verwijzing[];
}

interface ArtikelOutput {
  citeertitel: string;
  bwbId: string;
  artikel: string;
  versiedatum: string;
  pad?: string;
  leden: Lid[];
  bronreferentie: string;
}

interface GraphNode {
  id: string;
  label: string;
  group: string;
  type: "intern" | "extern" | "sectie" | "wet";
  bwbId: string;
  artikel?: string;
  bronreferentie: string;
  grad: number;
  // Welke wet (citeertitel)
  wet?: string;
  // Metadata (alleen intern)
  padVolledig?: string;
  aantalLeden?: number;
  leden?: Array<{ lid: string; tekst: string }>;
  // Metadata (extern)
  wetNaam?: string;
  // Metadata (sectie/wet)
  sectieType?: string;
  sectionNr?: string;
  sectionTitel?: string;
}

interface GraphLink {
  source: string;
  target: string;
  soort: "intref" | "extref" | "koppeling" | "structuur";
  label: string;
}

interface GraphData {
  metadata: {
    wetten: Array<{ bwbId: string; citeertitel: string }>;
    peildatum: string;
    aantalNodes: number;
    aantalLinks: number;
    aantalInternArtikelen: number;
    aantalExternReferenties: number;
    aantalStructuurLinks: number;
    aantalSectieNodes: number;
  };
  nodes: GraphNode[];
  links: GraphLink[];
}

// ── MCP-helpers ───────────────────────────────────────────────────────────────

function isRateLimit(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("Te veel verzoeken") || msg.includes("429") || msg.includes("-32000");
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  for (let poging = 0; poging <= MAX_RETRIES; poging++) {
    try {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text?: string }>;
      const text = blocks.find((b) => b.type === "text")?.text;
      if (!text) throw new Error(`Geen tekstblok in respons van ${name}`);
      const parsed = JSON.parse(text) as Record<string, unknown>;

      const fout = String(parsed["fout"] ?? "");
      if (isRateLimit(fout)) throw new Error(fout);
      if (parsed["fout"]) throw new Error(`${name} fout: ${parsed["fout"]}`);
      return parsed;
    } catch (err) {
      if (isRateLimit(err)) {
        if (poging === MAX_RETRIES)
          throw new Error(`${name}: rate-limit, max ${MAX_RETRIES} pogingen bereikt`);
        const wacht = RETRY_BASE_MS * Math.pow(2, poging);
        process.stdout.write(`\r  ⏳ rate-limit poging ${poging + 1}, wacht ${wacht / 1000}s…  `);
        await new Promise((r) => setTimeout(r, wacht));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${name}: onverwacht einde van retry-lus`);
}


// ── Structuurhulp ─────────────────────────────────────────────────────────────

function bouwHierarchie(
  structuurNodes: StructuurNode[],
  bwbId: string,
  citeertitel: string,
  parentId: string,
  nodes: Map<string, GraphNode>,
  links: GraphLink[],
  linkSet: Set<string>,
  inDegree: Map<string, number>,
  outDegree: Map<string, number>
): void {
  for (const sn of structuurNodes) {
    const sectieId = `${bwbId}#${sn.type}-${sn.nr}`;
    const typeKap = sn.type.charAt(0).toUpperCase() + sn.type.slice(1);
    const korteTitel = sn.titel
      ? `: ${sn.titel.slice(0, 45)}${sn.titel.length > 45 ? "…" : ""}`
      : "";
    const label = `${typeKap} ${sn.nr}${korteTitel}`;

    if (!nodes.has(sectieId)) {
      nodes.set(sectieId, {
        id: sectieId,
        label,
        group: label,
        type: "sectie",
        bwbId,
        bronreferentie: sectieId,
        grad: 0,
        wet: citeertitel,
        sectieType: sn.type,
        sectionNr: sn.nr,
        sectionTitel: sn.titel,
      });
    }

    // parent → sectie
    const key = `${parentId}→${sectieId}`;
    if (!linkSet.has(key)) {
      linkSet.add(key);
      links.push({ source: parentId, target: sectieId, soort: "structuur", label: "bevat" });
      outDegree.set(parentId, (outDegree.get(parentId) ?? 0) + 1);
      inDegree.set(sectieId,  (inDegree.get(sectieId)  ?? 0) + 1);
    }

    // sectie → directe artikelen
    for (const nr of sn.artikelen ?? []) {
      const artikelId = `jci1.3:c:${bwbId}&artikel=${nr}`;
      if (!nodes.has(artikelId)) continue;
      const aKey = `${sectieId}→${artikelId}`;
      if (!linkSet.has(aKey)) {
        linkSet.add(aKey);
        links.push({ source: sectieId, target: artikelId, soort: "structuur", label: "bevat" });
        outDegree.set(sectieId,   (outDegree.get(sectieId)   ?? 0) + 1);
        inDegree.set(artikelId,   (inDegree.get(artikelId)   ?? 0) + 1);
      }
    }

    // recursief voor sub-secties
    if (sn.secties) {
      bouwHierarchie(sn.secties, bwbId, citeertitel, sectieId, nodes, links, linkSet, inDegree, outDegree);
    }
  }
}

function collectArtikelen(nodes: StructuurNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.artikelen) result.push(...node.artikelen);
    if (node.secties) result.push(...collectArtikelen(node.secties));
  }
  return [...new Set(result)];
}

function extractGroep(pad?: string): string {
  if (!pad) return "Overig";
  const parts = pad.split(" > ");
  const top = parts.find(
    (p) =>
      /^hoofdstuk/i.test(p) ||
      /^afdeling/i.test(p) ||
      /^deel\b/i.test(p) ||
      /^titel\b/i.test(p) ||
      /^paragraaf/i.test(p)
  );
  return top ?? parts[0] ?? "Overig";
}

function stripJciSuffix(jci: string): string {
  return jci.replace(/&lid=[^&]*/g, "").replace(/&g=[^&]*/g, "");
}

function externNodeId(target: string, bwbIdDoel?: string): string {
  const stripped = stripJciSuffix(target);
  if (stripped.includes("&artikel=")) return stripped;
  return bwbIdDoel ?? stripped;
}

// ── Concurrency-beperkte uitvoering ──────────────────────────────────────────

async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  const queue = items.map((item, i) => ({ item, i }));

  async function worker() {
    for (;;) {
      const entry = queue.shift();
      if (!entry) break;
      try {
        results[entry.i] = await fn(entry.item, entry.i);
      } catch (err) {
        console.error(
          `\n  Overgeslagen artikel #${entry.i} (${entry.item}):`,
          (err as Error).message
        );
      }
      if (REQUEST_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

// ── Hoofd-script ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client(
    { name: "kennisgraaf-extractor", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  console.log("✓ Verbonden met wettenbank MCP\n");

  // 1. BWB-IDs bepalen
  let bwbIds: string[];
  if (CLI_BWB_IDS.length > 0) {
    bwbIds = CLI_BWB_IDS;
    console.log(`BWB-IDs via argument: ${bwbIds.join(", ")}\n`);
  } else {
    const zoekResult = (await callTool(client, "wettenbank_zoek", {
      titel: "Invorderingswet 1990",
      regelingsoort: "wet",
    })) as ZoekOutput;
    const regeling = zoekResult.regelingen?.[0];
    if (!regeling) {
      throw new Error(
        "Invorderingswet 1990 niet gevonden. Geef het BWB-ID als argument: npx tsx extract.ts BWBR0004770"
      );
    }
    bwbIds = [regeling.bwbId];
    console.log(`Wet gevonden via zoeken: ${regeling.titel} (${regeling.bwbId})\n`);
  }

  const wettenSet = new Set(bwbIds);
  const peildatum = new Date().toISOString().split("T")[0]!;

  // 2. Per wet: structuur + artikelen ophalen
  interface WetData {
    bwbId: string;
    citeertitel: string;
    artikelNummers: string[];
    artikelData: (ArtikelOutput | null)[];
    structuur: StructuurNode[];
  }

  const wettenData: WetData[] = [];

  for (const bwbId of bwbIds) {
    console.log(`── Verwerken: ${bwbId} ───────────────────────────────────────`);
    const structuurResult = (await callTool(client, "wettenbank_structuur", {
      bwbId,
    })) as StructuurOutput;
    const citeertitel = structuurResult.citeertitel;
    const artikelNummers = collectArtikelen(structuurResult.structuur);
    console.log(`  ${citeertitel}`);
    console.log(`  ${artikelNummers.length} artikelen gevonden\n`);

    let done = 0;
    const artikelData = (await withConcurrency(
      artikelNummers,
      async (nr) => {
        const data = (await callTool(client, "wettenbank_artikel", {
          bwbId,
          artikel: nr,
        })) as ArtikelOutput;
        done++;
        if (done % 10 === 0 || done === artikelNummers.length) {
          process.stdout.write(`\r  ${done}/${artikelNummers.length} opgehaald...`);
        }
        return data;
      },
      CONCURRENCY
    )) as (ArtikelOutput | null)[];
    console.log("\n");

    wettenData.push({ bwbId, citeertitel, artikelNummers, artikelData, structuur: structuurResult.structuur });
  }

  // 3. Graph opbouwen
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const linkSet = new Set<string>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const externWetNamen = new Map<string, string>();

  // Opzoektabel: bwbId → citeertitel (voor koppeling-nodes)
  const wetNaamVanId = new Map<string, string>(
    wettenData.map((w) => [w.bwbId, w.citeertitel])
  );

  // 3a. Alle interne artikelknopen voor alle wetten aanmaken
  for (const { bwbId, citeertitel, artikelNummers, artikelData } of wettenData) {
    for (let i = 0; i < artikelNummers.length; i++) {
      const data = artikelData[i];
      const nr = artikelNummers[i]!;
      const nodeId = `jci1.3:c:${bwbId}&artikel=${nr}`;
      nodes.set(nodeId, {
        id: nodeId,
        label: `Art. ${nr}`,
        group: extractGroep(data?.pad),
        type: "intern",
        bwbId,
        artikel: nr,
        bronreferentie: data?.bronreferentie ?? nodeId,
        grad: 0,
        wet: citeertitel,
        padVolledig: data?.pad ?? undefined,
        aantalLeden: data?.leden.length ?? 0,
        leden: data?.leden.map((l) => ({ lid: l.lid, tekst: l.tekst })) ?? [],
      });
    }
  }

  // 3a-bis. Structuurlinks: wet-nodes + hiërarchie (wet → sectie → artikel)
  for (const { bwbId, citeertitel, artikelNummers, structuur } of wettenData) {
    const artikelSet = new Set(artikelNummers);

    // Sub-artikel parent-child: "9.1" → parent "9" (alleen als parent ook een artikel-node is)
    for (const nr of artikelNummers) {
      const dot = nr.indexOf(".");
      if (dot < 1) continue;
      const parentNr = nr.slice(0, dot);
      if (!artikelSet.has(parentNr)) continue;
      const src = `jci1.3:c:${bwbId}&artikel=${parentNr}`;
      const tgt = `jci1.3:c:${bwbId}&artikel=${nr}`;
      const key = `${src}→${tgt}`;
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({ source: src, target: tgt, soort: "structuur", label: `bevat ${nr}` });
      outDegree.set(src, (outDegree.get(src) ?? 0) + 1);
      inDegree.set(tgt,  (inDegree.get(tgt)  ?? 0) + 1);
    }

    // Wet-node als root van de hiërarchie
    const wetId = `wet:${bwbId}`;
    nodes.set(wetId, {
      id: wetId,
      label: citeertitel,
      group: citeertitel,
      type: "wet",
      bwbId,
      bronreferentie: wetId,
      grad: 0,
      wet: citeertitel,
    });

    // Sectie-nodes + hiërarchische links recursief opbouwen
    bouwHierarchie(structuur, bwbId, citeertitel, wetId, nodes, links, linkSet, inDegree, outDegree);
  }

  // 3b. Links + externe/koppeling-knopen
  for (const { bwbId, citeertitel, artikelNummers, artikelData } of wettenData) {
    for (let i = 0; i < artikelNummers.length; i++) {
      const data = artikelData[i];
      if (!data) continue;
      const nr = artikelNummers[i]!;
      const sourceId = `jci1.3:c:${bwbId}&artikel=${nr}`;
      const gezieneDoelen = new Set<string>();

      for (const lid of data.leden) {
        if (!lid.verwijzingen?.length) continue;
        for (const v of lid.verwijzingen) {
          const targetId =
            v.soort === "intref"
              ? stripJciSuffix(v.target)
              : externNodeId(v.target, v.bwbIdDoel);

          if (!targetId || targetId === sourceId || gezieneDoelen.has(targetId)) continue;
          gezieneDoelen.add(targetId);

          const linkKey = `${sourceId}→${targetId}`;
          if (linkSet.has(linkKey)) continue;
          linkSet.add(linkKey);

          // Bepaal linktype
          let soort: "intref" | "extref" | "koppeling";
          if (v.soort === "intref") {
            soort = "intref";
          } else if (v.bwbIdDoel && wettenSet.has(v.bwbIdDoel)) {
            soort = "koppeling";
          } else {
            soort = "extref";
          }

          links.push({ source: sourceId, target: targetId, soort, label: v.label });
          outDegree.set(sourceId, (outDegree.get(sourceId) ?? 0) + 1);
          inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);

          // Koppeling-doel: intern node in een andere wet uit onze set
          if (soort === "koppeling" && !nodes.has(targetId)) {
            const doelBwbId = v.bwbIdDoel!;
            const doelCiteertitel = wetNaamVanId.get(doelBwbId) ?? doelBwbId;
            const refNr = targetId.match(/&artikel=([^&]+)/)?.[1] ?? "?";
            nodes.set(targetId, {
              id: targetId,
              label: `Art. ${refNr}`,
              group: "Overig",
              type: "intern",
              bwbId: doelBwbId,
              artikel: refNr,
              bronreferentie: targetId,
              grad: 0,
              wet: doelCiteertitel,
            });
          }

          // Externe wet-node
          if (soort === "extref" && !nodes.has(targetId)) {
            const heeftArtikel = targetId.includes("&artikel=");
            const wetNaam = v.label;
            if (v.bwbIdDoel) externWetNamen.set(v.bwbIdDoel, wetNaam);
            nodes.set(targetId, {
              id: targetId,
              label: heeftArtikel ? v.label : (wetNaam || targetId),
              group: v.bwbIdDoel ?? "Extern",
              type: "extern",
              bwbId: v.bwbIdDoel ?? "",
              artikel: targetId.match(/&artikel=([^&]+)/)?.[1],
              bronreferentie: targetId,
              grad: 0,
              wetNaam: wetNaam || undefined,
            });
          }

          // Intern phantom (intref naar onbekend artikel binnen zelfde wet)
          if (soort === "intref" && !nodes.has(targetId)) {
            const refNr = targetId.match(/&artikel=([^&]+)/)?.[1] ?? "?";
            nodes.set(targetId, {
              id: targetId,
              label: `Art. ${refNr}`,
              group: "Overig",
              type: "intern",
              bwbId,
              artikel: refNr,
              bronreferentie: targetId,
              grad: 0,
              wet: citeertitel,
            });
          }
        }
      }
    }
  }

  // 3c. Tweede pass: intern nodes zonder leden opnieuw ophalen
  const ontbrekend = [...nodes.values()].filter(
    (n) =>
      n.type === "intern" &&
      n.artikel &&
      n.artikel !== "?" &&
      (!n.leden || n.leden.length === 0)
  );
  if (ontbrekend.length > 0) {
    console.log(`Tweede pass: ${ontbrekend.length} artikelen zonder tekst opnieuw ophalen...`);
    let done2 = 0;
    await withConcurrency(
      ontbrekend,
      async (node) => {
        const data = (await callTool(client, "wettenbank_artikel", {
          bwbId: node.bwbId || bwbIds[0],
          artikel: node.artikel!,
        })) as ArtikelOutput;
        done2++;
        if (done2 % 10 === 0 || done2 === ontbrekend.length) {
          process.stdout.write(`\r  ${done2}/${ontbrekend.length} hersteld...`);
        }
        if (data?.leden?.length) {
          node.padVolledig = data.pad ?? node.padVolledig;
          node.aantalLeden = data.leden.length;
          node.leden = data.leden.map((l) => ({ lid: l.lid, tekst: l.tekst }));
          node.bronreferentie = data.bronreferentie ?? node.bronreferentie;
          if (!node.padVolledig || node.group === "Overig") {
            node.group = extractGroep(data.pad);
          }
          if (!node.wet && data.citeertitel) {
            node.wet = data.citeertitel;
          }
        }
        return data;
      },
      CONCURRENCY
    );
    console.log("\n");
  }

  // 3d. grad en betere groepnamen voor externe knopen
  for (const [id, node] of nodes) {
    node.grad = (inDegree.get(id) ?? 0) + (outDegree.get(id) ?? 0);
    if (node.type === "extern" && node.bwbId && externWetNamen.has(node.bwbId)) {
      if (node.group === node.bwbId) node.group = externWetNamen.get(node.bwbId)!;
    }
  }

  // 4. graph.json schrijven
  const nodesArr = [...nodes.values()];
  const internArt = nodesArr.filter((n) => n.type === "intern");
  const externRef = nodesArr.filter((n) => n.type === "extern");
  const koppelingLinks = links.filter((l) => l.soort === "koppeling");

  const structuurLinks = links.filter((l) => l.soort === "structuur");
  const sectieNodes = nodesArr.filter((n) => n.type === "sectie" || n.type === "wet");
  const graphData: GraphData = {
    metadata: {
      wetten: wettenData.map((w) => ({ bwbId: w.bwbId, citeertitel: w.citeertitel })),
      peildatum,
      aantalNodes: nodesArr.length,
      aantalLinks: links.length,
      aantalInternArtikelen: internArt.length,
      aantalExternReferenties: externRef.length,
      aantalStructuurLinks: structuurLinks.length,
      aantalSectieNodes: sectieNodes.length,
    },
    nodes: nodesArr,
    links,
  };

  const uitvoerPad = join(dirname(fileURLToPath(import.meta.url)), "graph.json");
  writeFileSync(uitvoerPad, JSON.stringify(graphData, null, 2), "utf-8");

  console.log("Klaar!");
  console.log(`  ${nodesArr.length} nodes  (${internArt.length} intern · ${externRef.length} extern · ${sectieNodes.length} sectie/wet)`);
  console.log(
    `  ${links.length} links  ` +
      `(${links.filter((l) => l.soort === "intref").length} intref · ` +
      `${koppelingLinks.length} koppeling · ` +
      `${links.filter((l) => l.soort === "extref").length} extref · ` +
      `${structuurLinks.length} structuur)`
  );
  console.log(`  Opgeslagen: ${uitvoerPad}\n`);
  console.log("Open nu: npx serve . -l 4567  →  http://localhost:4567");

  await client.close();
}

main().catch((err) => {
  console.error("\nFout:", err.message ?? err);
  process.exit(1);
});
