/**
 * Tool handler: wettenbank_zoekterm
 * Zoekt artikelen die een begrip bevatten; optioneel met artikeltekst.
 */
import { ZoektermInputSchema } from "../shared/schemas.js";
import { detecteerFormaat, formatteerZodFout } from "../shared/utils.js";
import { ClientInputError } from "../shared/fouten.js";
import { haalWetstekstOp, extraheerDocMetadata, zoekPadEnElementInDom, } from "../clients/repository-client.js";
import { parseZoekterm, zoekTermInArtikelDom } from "../search/zoekterm-engine.js";
import { parseElement, normalizeNode, transformToMcpLite, } from "../bwb-parser/index.js";
export async function handleZoekterm(args, signaal) {
    const parsed = ZoektermInputSchema.safeParse(args);
    if (!parsed.success)
        throw new ClientInputError(formatteerZodFout(parsed.error));
    const { bwbId, zoekterm, peildatum, maxResultaten, includeerTekst } = parsed.data;
    const { doc, regeling } = await haalWetstekstOp(bwbId, peildatum, signaal);
    const meta = extraheerDocMetadata(doc);
    const wetNaam = meta.citeertitel || regeling.titel;
    const versiedatum = meta.versiedatum || regeling.geldigVanaf;
    const root = doc.documentElement;
    const resultaat = zoekTermInArtikelDom(doc, parseZoekterm(zoekterm), maxResultaten);
    // Versiespecifieke jci per gevonden artikel — zo is elke treffer direct herleidbaar
    // zonder een extra wettenbank_artikel-aanroep.
    // &z= (zichtdatum) én &g= (geldigheidsdatum) samen — alleen &g= landt bovenaan de wet.
    const jciVoor = (artikelnr) => `jci1.3:c:${bwbId}&artikel=${artikelnr}` +
        (versiedatum ? `&z=${versiedatum}&g=${versiedatum}` : "");
    // Voeg optioneel artikeltekst toe
    const artikelen = await Promise.all(resultaat.artikelen.map(async (art) => {
        const basis = { ...art, bronreferentie: jciVoor(art.artikel) };
        if (!includeerTekst)
            return basis;
        const treffer = zoekPadEnElementInDom(root, art.artikel);
        if (!treffer)
            return basis;
        const rawNode = parseElement(treffer.element, bwbId, []);
        const normalized = normalizeNode(rawNode);
        const mcpNodes = transformToMcpLite(normalized, bwbId, wetNaam, versiedatum);
        const tekst = mcpNodes.map((n) => n.tekst).join("\n\n");
        const formaat = detecteerFormaat(tekst);
        // pad zoals bij wettenbank_artikel: containers + artikel-label.
        const artikelLabel = mcpNodes[0]?.sectie
            .split(" > ")
            .filter((d) => !d.startsWith("Lid "))
            .pop();
        const pad = treffer.containerPad.length > 0 && artikelLabel
            ? [...treffer.containerPad, artikelLabel].join(" > ")
            : undefined;
        return { ...basis, ...(pad && { pad }), tekst, formaat };
    }));
    return JSON.stringify({
        formaat: "plain",
        citeertitel: wetNaam,
        versiedatum,
        bwbId,
        zoekterm,
        totaalTreffers: resultaat.totaalTreffers,
        isVolledig: resultaat.isVolledig,
        aantalArtikelen: artikelen.length,
        artikelen,
    });
}
