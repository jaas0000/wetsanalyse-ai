/**
 * Tool handler: wettenbank_structuur
 * Retourneert de inhoudsopgave van een wet: hierarchische structuur zonder artikeltekst.
 * Stelt een LLM in staat gericht te navigeren zonder de volledige wet te laden.
 */

import { StructuurInputSchema } from "../shared/schemas.js";
import type { StructuurNode } from "../shared/schemas.js";
import { formatteerZodFout } from "../shared/utils.js";
import { ClientInputError } from "../shared/fouten.js";
import {
  haalWetstekstOp,
  extraheerDocMetadata,
} from "../clients/repository-client.js";
import { parseBwbVanDom, normalizeNode } from "../bwb-parser/index.js";
import type { NormalizedNode, NormalizedArtikel } from "../bwb-parser/index.js";

// Structurele container-types in BWB-wetten
const CONTAINER_TYPES = new Set([
  "hoofdstuk",
  "afdeling",
  "paragraaf",
  "subparagraaf",
  "titel",
  "deel",
  "boek",
  "circulaire-tekst",
  // Bijlagen en hun generieke onderverdelingen: de normalizer behandelt deze ook als
  // container (zie BEKENDE_CONTAINER_TYPES). Zonder ze hier zouden ze als transparante
  // wrapper worden behandeld — de bijlage-kop verdwijnt dan uit de inhoudsopgave en
  // artikelen die er direct onder hangen gaan verloren.
  "bijlage",
  "divisie",
]);

// Artikel-types (leaf-nodes in de structuur)
const ARTIKEL_TYPES = new Set(["artikel", "circulaire_divisie"]);

type ContainerLike = NormalizedNode & {
  children: NormalizedNode[];
  metadata: { nr?: string; titel?: string };
};

/**
 * Traverseert de genormaliseerde boom en bouwt de structuurhiërarchie.
 */
export function bouwStructuurNodes(node: NormalizedNode): StructuurNode[] {
  if (ARTIKEL_TYPES.has(node.type)) return [];
  if (!("children" in node) || !node.children) return [];

  const container = node as ContainerLike;

  if (CONTAINER_TYPES.has(node.type)) {
    const directeArtikelen = container.children
      .filter((c) => ARTIKEL_TYPES.has(c.type))
      .map((c) => (c as NormalizedArtikel).nr)
      .filter((nr): nr is string => Boolean(nr));

    const subSecties = container.children
      .filter((c) => CONTAINER_TYPES.has(c.type))
      .flatMap((c) => bouwStructuurNodes(c));

    const structuurNode: StructuurNode = {
      type: node.type,
      nr: container.metadata.nr ?? "",
      ...(container.metadata.titel && { titel: container.metadata.titel }),
      ...(directeArtikelen.length > 0 && { artikelen: directeArtikelen }),
      ...(subSecties.length > 0 && { secties: subSecties }),
    };
    return [structuurNode];
  }

  // Root/wrapper-node (wetgeving, wettekst, regeling, toestand, etc.): transparant doorgaan
  return container.children.flatMap((c) => bouwStructuurNodes(c));
}

/**
 * Fallback: als er geen structuurcontainers zijn, geef een platte artikellijst terug.
 */
function bouwPlatteArtikelStructuur(node: NormalizedNode): StructuurNode[] {
  const artikelen: string[] = [];

  function verzamel(n: NormalizedNode): void {
    if (ARTIKEL_TYPES.has(n.type)) {
      const nr = (n as NormalizedArtikel).nr;
      if (nr) artikelen.push(nr);
      return;
    }
    if ("children" in n && n.children) {
      (n.children as NormalizedNode[]).forEach(verzamel);
    }
  }

  verzamel(node);
  if (!artikelen.length) return [];
  return [{ type: "wet", nr: "", artikelen }];
}

/**
 * Filtert op sectie: nodes waarvan nr (exact, case-insensitief) of titel
 * (substring) matcht, inclusief hun volledige subboom.
 */
export function filterOpSectie(nodes: StructuurNode[], sectie: string): StructuurNode[] {
  const zoek = sectie.trim().toLowerCase();
  const treffers: StructuurNode[] = [];
  for (const node of nodes) {
    const nrMatch = node.nr.trim().toLowerCase() === zoek;
    const titelMatch = Boolean(node.titel && node.titel.toLowerCase().includes(zoek));
    if (nrMatch || titelMatch) {
      treffers.push(node);
      continue; // subboom zit al in de treffer
    }
    if (node.secties) treffers.push(...filterOpSectie(node.secties, sectie));
  }
  return treffers;
}

/**
 * Kapt de boom af op `diepte` niveaus. Afgekapte nodes krijgen `ingekort: true`
 * zodat zichtbaar blijft dát er meer is (opvraagbaar via de sectie-parameter) —
 * stil weglaten zou de inhoudsopgave misleidend compleet doen lijken.
 */
export function beperkDiepte(nodes: StructuurNode[], diepte: number): StructuurNode[] {
  return nodes.map((node) => {
    if (!node.secties || node.secties.length === 0) return node;
    if (diepte <= 1) {
      const { secties: _weg, ...rest } = node;
      return { ...rest, ingekort: true };
    }
    return { ...node, secties: beperkDiepte(node.secties, diepte - 1) };
  });
}

export async function handleStructuur(args: unknown, signaal?: AbortSignal): Promise<string> {
  const parsed = StructuurInputSchema.safeParse(args);
  if (!parsed.success) throw new ClientInputError(formatteerZodFout(parsed.error));

  const { bwbId, peildatum, diepte, sectie } = parsed.data;

  const { doc, regeling } = await haalWetstekstOp(bwbId, peildatum, signaal);
  const docMeta = extraheerDocMetadata(doc);
  const wetNaam = docMeta.citeertitel || regeling.titel;

  // Hergebruik het al geparste Document uit de cache — geen tweede DOM-parse.
  const rawNode = parseBwbVanDom(doc.documentElement, bwbId);
  const normalized = normalizeNode(rawNode);

  let structuur = bouwStructuurNodes(normalized);
  if (!structuur.length) {
    structuur = bouwPlatteArtikelStructuur(normalized);
  }

  if (sectie) {
    structuur = filterOpSectie(structuur, sectie);
    if (!structuur.length) {
      throw new ClientInputError(
        `Geen sectie gevonden die matcht op "${sectie}" in ${bwbId}. ` +
          "Roep wettenbank_structuur zonder sectie-parameter aan voor de volledige inhoudsopgave."
      );
    }
  }
  if (diepte !== undefined) {
    structuur = beperkDiepte(structuur, diepte);
  }

  return JSON.stringify({
    formaat: "plain",
    bwbId,
    citeertitel: wetNaam,
    ...(regeling.type && { type: regeling.type }),
    versiedatum: docMeta.versiedatum || regeling.geldigVanaf,
    structuur,
  });
}
