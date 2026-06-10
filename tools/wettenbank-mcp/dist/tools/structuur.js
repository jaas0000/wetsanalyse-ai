/**
 * Tool handler: wettenbank_structuur
 * Retourneert de inhoudsopgave van een wet: hierarchische structuur zonder artikeltekst.
 * Stelt een LLM in staat gericht te navigeren zonder de volledige wet te laden.
 */
import { StructuurInputSchema } from "../shared/schemas.js";
import { haalWetstekstOp, extraheerDocMetadata, } from "../clients/repository-client.js";
import { parseBwbXml, normalizeNode } from "../bwb-parser/index.js";
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
/**
 * Traverseert de genormaliseerde boom en bouwt de structuurhiërarchie.
 */
export function bouwStructuurNodes(node) {
    if (ARTIKEL_TYPES.has(node.type))
        return [];
    if (!("children" in node) || !node.children)
        return [];
    const container = node;
    if (CONTAINER_TYPES.has(node.type)) {
        const directeArtikelen = container.children
            .filter((c) => ARTIKEL_TYPES.has(c.type))
            .map((c) => c.nr)
            .filter((nr) => Boolean(nr));
        const subSecties = container.children
            .filter((c) => CONTAINER_TYPES.has(c.type))
            .flatMap((c) => bouwStructuurNodes(c));
        const structuurNode = {
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
function bouwPlatteArtikelStructuur(node) {
    const artikelen = [];
    function verzamel(n) {
        if (ARTIKEL_TYPES.has(n.type)) {
            const nr = n.nr;
            if (nr)
                artikelen.push(nr);
            return;
        }
        if ("children" in n && n.children) {
            n.children.forEach(verzamel);
        }
    }
    verzamel(node);
    if (!artikelen.length)
        return [];
    return [{ type: "wet", nr: "", artikelen }];
}
export async function handleStructuur(args) {
    const parsed = StructuurInputSchema.safeParse(args);
    if (!parsed.success)
        throw new Error(parsed.error.issues[0].message);
    const { bwbId, peildatum } = parsed.data;
    const { rawXml, doc, regeling } = await haalWetstekstOp(bwbId, peildatum);
    const docMeta = extraheerDocMetadata(doc);
    const wetNaam = docMeta.citeertitel || regeling.titel;
    const rawNode = parseBwbXml(rawXml, bwbId);
    const normalized = normalizeNode(rawNode);
    let structuur = bouwStructuurNodes(normalized);
    if (!structuur.length) {
        structuur = bouwPlatteArtikelStructuur(normalized);
    }
    return JSON.stringify({
        formaat: "plain",
        bwbId,
        citeertitel: wetNaam,
        versiedatum: docMeta.versiedatum || regeling.geldigVanaf,
        structuur,
    });
}
