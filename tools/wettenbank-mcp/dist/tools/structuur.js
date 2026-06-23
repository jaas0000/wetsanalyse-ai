/**
 * Tool handler: wettenbank_structuur
 * Retourneert de inhoudsopgave van een wet: hierarchische structuur zonder artikeltekst.
 * Stelt een LLM in staat gericht te navigeren zonder de volledige wet te laden.
 */
import { StructuurInputSchema } from "../shared/schemas.js";
import { formatteerZodFout } from "../shared/utils.js";
import { ClientInputError } from "../shared/fouten.js";
import { haalWetstekstOp, extraheerDocMetadata, } from "../clients/repository-client.js";
import { parseBwbVanDom, normalizeNode } from "../bwb-parser/index.js";
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
 * Een circulaire.divisie (Leidraad) is hybride: een bepaling die zelf een leaf kan
 * zijn én geneste sub-divisies (9 → 9.1 → 9.1.1) draagt. Die nesting zit in het veld
 * `subdivisies` (niet `children`).
 */
// Géén type-predicaat (`node is NormalizedArtikel`): bij negatie (`!heeftSubdivisies`)
// zou TS dat als negatief predicaat afleiden en een al-NormalizedArtikel-array tot
// `never[]` versmallen. Een platte boolean houdt de element-typen intact.
function heeftSubdivisies(node) {
    return (node.type === "circulaire_divisie" &&
        Array.isArray(node.subdivisies) &&
        node.subdivisies.length > 0);
}
/**
 * Bouwt de structuurnode(s) voor een circulaire.divisie. Zonder sub-divisies is de
 * divisie een leaf-bepaling: de ouder neemt ze als artikelnummer op, dus geen eigen
 * node ([]). Mét sub-divisies wordt ze een eigen sectie met de geneste niveaus
 * eronder — leaf-subdivisies als `artikelen`, dieper geneste recursief als `secties`.
 */
function bouwDivisieNodes(div) {
    const subs = div.subdivisies ?? [];
    if (subs.length === 0)
        return [];
    const directeArtikelen = subs
        .filter((s) => !heeftSubdivisies(s))
        .map((s) => s.nr)
        .filter((nr) => Boolean(nr));
    const subSecties = subs
        .filter((s) => heeftSubdivisies(s))
        .flatMap((s) => bouwDivisieNodes(s));
    return [
        {
            type: div.type,
            nr: div.nr ?? "",
            ...(div.titel && { titel: div.titel }),
            ...(directeArtikelen.length > 0 && { artikelen: directeArtikelen }),
            ...(subSecties.length > 0 && { secties: subSecties }),
        },
    ];
}
/**
 * Traverseert de genormaliseerde boom en bouwt de structuurhiërarchie.
 */
export function bouwStructuurNodes(node) {
    // circulaire.divisie (Leidraad): hybride leaf/container — apart behandeld zodat de
    // geneste sub-divisies in de inhoudsopgave verschijnen i.p.v. te verdwijnen.
    if (node.type === "circulaire_divisie") {
        return bouwDivisieNodes(node);
    }
    if (node.type === "artikel")
        return [];
    if (!("children" in node) || !node.children)
        return [];
    const container = node;
    if (CONTAINER_TYPES.has(node.type)) {
        // Leaf-bepalingen: gewone artikelen én circulaire.divisies zónder sub-divisies.
        const directeArtikelen = container.children
            .filter((c) => c.type === "artikel" || (c.type === "circulaire_divisie" && !heeftSubdivisies(c)))
            .map((c) => c.nr)
            .filter((nr) => Boolean(nr));
        // Sub-secties: echte containers én divisies mét geneste sub-divisies.
        const subSecties = container.children
            .filter((c) => CONTAINER_TYPES.has(c.type) || heeftSubdivisies(c))
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
            // Een circulaire.divisie kan zelf geneste sub-divisies dragen; ook die platslaan
            // i.p.v. ze stil te laten vallen (geen verlies in de fallback).
            n.subdivisies?.forEach(verzamel);
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
/**
 * Filtert op sectie: nodes waarvan nr (exact, case-insensitief) of titel
 * (substring) matcht, inclusief hun volledige subboom.
 */
export function filterOpSectie(nodes, sectie) {
    const zoek = sectie.trim().toLowerCase();
    const treffers = [];
    for (const node of nodes) {
        const nrMatch = node.nr.trim().toLowerCase() === zoek;
        const titelMatch = Boolean(node.titel && node.titel.toLowerCase().includes(zoek));
        if (nrMatch || titelMatch) {
            treffers.push(node);
            continue; // subboom zit al in de treffer
        }
        if (node.secties)
            treffers.push(...filterOpSectie(node.secties, sectie));
    }
    return treffers;
}
/**
 * Kapt de boom af op `diepte` niveaus. Afgekapte nodes krijgen `ingekort: true`
 * zodat zichtbaar blijft dát er meer is (opvraagbaar via de sectie-parameter) —
 * stil weglaten zou de inhoudsopgave misleidend compleet doen lijken.
 */
export function beperkDiepte(nodes, diepte) {
    return nodes.map((node) => {
        if (!node.secties || node.secties.length === 0)
            return node;
        if (diepte <= 1) {
            const { secties: _weg, ...rest } = node;
            return { ...rest, ingekort: true };
        }
        return { ...node, secties: beperkDiepte(node.secties, diepte - 1) };
    });
}
export async function handleStructuur(args, signaal) {
    const parsed = StructuurInputSchema.safeParse(args);
    if (!parsed.success)
        throw new ClientInputError(formatteerZodFout(parsed.error));
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
            throw new ClientInputError(`Geen sectie gevonden die matcht op "${sectie}" in ${bwbId}. ` +
                "Roep wettenbank_structuur zonder sectie-parameter aan voor de volledige inhoudsopgave.");
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
