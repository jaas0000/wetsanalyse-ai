/**
 * Brongetrouwheidstests op de volledige parse-keten (XML → RAW → NORMALIZED →
 * MCP-LITE), tegen een schema-getrouwe BWB-toestand-fixture.
 *
 * Kern: de round-trip-invariant — élke tekstnode uit de bron-XML moet terugkomen
 * in de gerenderde output. Stil tekstverlies (aaneengeplakte woorden, verdwenen
 * lijstniveaus, weggevallen tabellen of aanhefteksten) is hier de klasse bugs
 * die dit bestand structureel moet vangen.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { parseBwb } from "./index.js";

const FIXTURE = readFileSync(
  new URL("./fixtures/toestand-fixture.xml", import.meta.url),
  "utf8"
);

const resultaat = parseBwb(FIXTURE, "BWBR0099999", "Testwet brongetrouwheid", "2024-01-01");
const alleTekst = resultaat.mcpLite.map((n) => `${n.sectie}\n${n.tekst}`).join("\n\n");

/**
 * Witruimte-genormaliseerde tekstfragmenten van alle tekstnodes binnen <wettekst>.
 * Documentmetadata daarbuiten (intitule, citeertitel) is geen artikelinhoud en
 * hoort niet in de content-output — wel in de respons-metadata van de tools.
 */
function bronTekstFragmenten(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const wettekst = doc.getElementsByTagName("wettekst")[0];
  const fragmenten: string[] = [];
  type Node = { nodeType: number; nodeValue: string | null; childNodes: { length: number; item(i: number): Node } };
  (function loop(node: Node): void {
    if (node.nodeType === 3) {
      const tekst = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if (tekst) fragmenten.push(tekst);
      return;
    }
    for (let i = 0; i < node.childNodes.length; i++) loop(node.childNodes.item(i));
  })(wettekst as unknown as Node);
  return fragmenten;
}

describe("brongetrouwheid — round-trip-invariant", () => {
  it("elke tekstnode uit de bron komt voor in de gerenderde output", () => {
    const genormaliseerd = alleTekst.replace(/\s+/g, " ");
    for (const fragment of bronTekstFragmenten(FIXTURE)) {
      // <br/> binnen een alinea splitst een tekstnode; render voegt een spatie in.
      // Vergelijk daarom per fragment, witruimte-genormaliseerd.
      expect(genormaliseerd, `tekstnode raakte zoek: "${fragment}"`).toContain(fragment);
    }
  });
});

describe("brongetrouwheid — gerepareerde verliesgevallen", () => {
  it("behoudt de spatie tussen opeenvolgende inline-verwijzingen", () => {
    // Vroeger: "[artikel 2](…)[artikel 3](…)" — woorden plakten aaneen.
    expect(alleTekst).toMatch(/artikel 2\]\([^)]*\) \[artikel 3\]/);
  });

  it("rendert <br/> als woordscheiding, niet als lege string", () => {
    expect(alleTekst).toContain("Eerste regel tweede regel");
    expect(alleTekst).not.toContain("regeltweede");
  });

  it("rendert het derde lijstniveau (a → 1° → i) met indentatie", () => {
    expect(alleTekst).toContain("diepste subonderdeel op niveau drie");
    expect(alleTekst).toMatch(/ {4}i\. diepste subonderdeel/);
  });

  it("rendert een tabel binnen een lijstitem", () => {
    expect(alleTekst).toContain("tariefgroep");
    expect(alleTekst).toContain("vier procent");
  });

  it("behoudt de aanhef die naast genummerde leden staat", () => {
    expect(alleTekst).toContain("Aanhef die naast de genummerde leden staat.");
  });

  it("behoudt de slotalinea ná een opsomming binnen een lid (documentvolgorde)", () => {
    const lid2 = resultaat.mcpLite.find((n) => n.sectie.endsWith("Artikel 9 > Lid 2"));
    expect(lid2).toBeDefined();
    const posLijst = lid2!.tekst.indexOf("onderdeel b");
    const posSlot = lid2!.tekst.indexOf("Slotalinea van het tweede lid");
    expect(posLijst).toBeGreaterThanOrEqual(0);
    expect(posSlot).toBeGreaterThan(posLijst);
  });
});

describe("brongetrouwheid — traceerbare bronreferenties", () => {
  it("geeft lid-nodes een artikel-, lid- én versiespecifieke jci-uri", () => {
    const lid2 = resultaat.mcpLite.find((n) => n.sectie.endsWith("Artikel 9 > Lid 2"));
    expect(lid2?.bronreferentie).toBe("jci1.3:c:BWBR0099999&artikel=9&lid=2&g=2024-01-01");
  });

  it("geeft een artikel zonder leden een artikel- en versiespecifieke jci-uri", () => {
    const art1 = resultaat.mcpLite.find((n) => n.sectie.endsWith("Artikel 1"));
    expect(art1?.bronreferentie).toBe("jci1.3:c:BWBR0099999&artikel=1&g=2024-01-01");
  });
});
