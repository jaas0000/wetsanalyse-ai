import { describe, it, expect } from "vitest";
import { parseBwb } from "./index.js";

describe("MCP-Lite Transformation", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR0024096" inwerkingtreding="2008-01-01">
  <wetgeving>
    <circulaire>
      <circulaire-tekst>
        <circulaire.divisie bwb-ng-variabel-deel="1.1.2">
          <kop>
            <label>Paragraaf</label>
            <nr>1.1.2</nr>
            <titel>Definities</titel>
          </kop>
          <tekst>
            <al>In deze leidraad wordt verstaan onder:</al>
          </tekst>
          <lijst>
            <li>
              <li.nr>a.</li.nr>
              <al>besluit (het): het <extref doc="jci1.3:c:BWBR0004772" label="Uitvoeringsbesluit">Uitvoeringsbesluit</extref>;</al>
            </li>
          </lijst>
        </circulaire.divisie>
      </circulaire-tekst>
    </circulaire>
  </wetgeving>
</toestand>`;

  it("transforms a complex structure to MCP-Lite format", () => {
    const result = parseBwb(sampleXml, "BWBR0024096", "Leidraad Invordering 2008");
    
    // Bij circulaire_divisie splitsen we tekst-blokken en sub-divisies
    // In dit geval is er 1 lid (lid:0) dat zowel de al als de lijst bevat.
    expect(result.mcpLite.length).toBeGreaterThanOrEqual(1);
    const node = result.mcpLite[0];
    
    expect(node.bwbId).toBe("BWBR0024096");
    expect(node.citeertitel).toBe("Leidraad Invordering 2008");
    expect(node.sectie).toBe("Paragraaf 1.1.2 Definities");
    
    // Check for flattened text and Markdown links
    expect(node.tekst).toContain("In deze leidraad wordt verstaan onder:");
    expect(node.tekst).toContain("a. besluit (het): het [Uitvoeringsbesluit](jci1.3:c:BWBR0004772);");
    
    // Check bronreferentie
    expect(node.bronreferentie).toBe("jci1.3:c:BWBR0024096&artikel=1.1.2");
  });

  it("handles tables in MCP-Lite format", () => {
    const tableXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <table>
          <tgroup cols="2">
            <thead>
              <row>
                <entry>Header 1</entry>
                <entry>Header 2</entry>
              </row>
            </thead>
            <tbody>
              <row>
                <entry>Value 1</entry>
                <entry>Value 2</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(tableXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];
    
    expect(node.tekst).toContain("| Header 1 | Header 2 |");
    expect(node.tekst).toContain("| --- | --- |");
    expect(node.tekst).toContain("| Value 1 | Value 2 |");
  });

  it("blijft robuust bij niet-numerieke @cols / @morerows (geen NaN)", () => {
    const kapotXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <table>
          <tgroup cols="abc">
            <colspec colname="c1" colnum="x"/>
            <colspec colname="c2"/>
            <tbody>
              <row>
                <entry morerows="x">Cel A</entry>
                <entry>Cel B</entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(kapotXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];

    // @cols="abc" valt terug op colspecs.length (2); @colnum="x" en @morerows="x" geven
    // geen NaN. Beide cellen renderen, niets is corrupt.
    expect(node.tekst).not.toContain("NaN");
    expect(node.tekst).toContain("Cel A");
    expect(node.tekst).toContain("Cel B");
  });

  it("handles tables with nested 'al' tags in entries", () => {
    const tableAlXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <table>
          <tgroup cols="1">
            <tbody>
              <row>
                <entry><al>Geneste tekst</al></entry>
              </row>
            </tbody>
          </tgroup>
        </table>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(tableAlXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];
    
    expect(node.tekst).toContain("| Geneste tekst |");
  });

  it("deduplicates label and nr in section path", () => {
    const dedupXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><label>1.1.1</label><nr>1.1.1</nr><titel>Titel</titel></kop>
        <al>Tekst</al>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(dedupXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];
    
    // Should be "1.1.1 Titel", not "1.1.1 1.1.1 Titel"
    expect(node.sectie).toBe("1.1.1 Titel");
  });

  it("handles nested lists with indentation", () => {
     const nestedListXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <lijst>
          <li>
            <li.nr>1.</li.nr>
            <al>Buitenste item</al>
            <lijst>
              <li>
                <li.nr>a.</li.nr>
                <al>Binnenste item</al>
              </li>
            </lijst>
          </li>
        </lijst>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(nestedListXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];
    
    expect(node.tekst).toContain("1. Buitenste item");
    expect(node.tekst).toContain("  a. Binnenste item");
  });

  it("handles multiple lids correctly", () => {
    const multiLidXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <lid><lidnr>1</lidnr><al>Lid 1 tekst</al></lid>
        <lid><lidnr>2</lidnr><al>Lid 2 tekst</al></lid>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(multiLidXml, "BWBR12345", "Test Wet");
    expect(result.mcpLite).toHaveLength(2);
    expect(result.mcpLite[0].sectie).toContain("Lid 1");
    expect(result.mcpLite[1].sectie).toContain("Lid 2");
  });

  it("verzamelt intref/extref als verwijzingen, met tekst ongewijzigd", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR0004770" inwerkingtreding="2024-01-01">
  <wetgeving><wettekst>
    <artikel>
      <kop><nr>9</nr></kop>
      <lid><lidnr>2</lidnr>
        <al>In afwijking van <intref doc="jci1.3:c:BWBR0004770&amp;artikel=9&amp;lid=1">het eerste lid</intref> is een aanslag invorderbaar, mede gelet op <extref doc="jci1.3:c:BWBR0002320&amp;artikel=4">artikel 4 van de Awb</extref>.</al>
      </lid>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const node = parseBwb(xml, "BWBR0004770", "Invorderingswet 1990").mcpLite[0];

    // De tekst behoudt de inline-Markdown-links (backward compatible).
    expect(node.tekst).toContain("[het eerste lid](jci1.3:c:BWBR0004770&artikel=9&lid=1)");
    expect(node.tekst).toContain("[artikel 4 van de Awb](jci1.3:c:BWBR0002320&artikel=4)");

    // En de verwijzingen staan los, machine-leesbaar.
    expect(node.verwijzingen).toHaveLength(2);
    const [intern, extern] = node.verwijzingen!;

    expect(intern.soort).toBe("intref");
    expect(intern.label).toBe("het eerste lid");
    expect(intern.bwbIdDoel).toBe("BWBR0004770");
    expect(intern.extern).toBe(false);

    expect(extern.soort).toBe("extref");
    expect(extern.label).toBe("artikel 4 van de Awb");
    expect(extern.bwbIdDoel).toBe("BWBR0002320");
    expect(extern.extern).toBe(true);
  });

  it("laat verwijzingen weg wanneer een lid geen intref/extref bevat", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR0004770">
  <wetgeving><wettekst>
    <artikel><kop><nr>9</nr></kop>
      <lid><lidnr>1</lidnr><al>Een belastingaanslag is invorderbaar zes weken na de dagtekening.</al></lid>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const node = parseBwb(xml, "BWBR0004770", "Invorderingswet 1990").mcpLite[0];
    expect(node.verwijzingen).toBeUndefined();
  });

  it("behoudt de blokvolgorde tekst → tabel → tekst binnen één lid (#5)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving><wettekst>
    <artikel>
      <kop><nr>1</nr></kop>
      <lid><lidnr>1</lidnr>
        <al>Tekst voor de tabel.</al>
        <table><tgroup cols="1"><tbody>
          <row><entry>Celwaarde</entry></row>
        </tbody></tgroup></table>
        <al>Tekst na de tabel.</al>
      </lid>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const result = parseBwb(xml, "BWBR12345", "Test Wet");
    const tekst = result.mcpLite[0].tekst;
    // De afsluitende tekst mag niet vóór de tabel terechtkomen.
    expect(tekst.indexOf("Tekst voor de tabel.")).toBeLessThan(tekst.indexOf("| Celwaarde |"));
    expect(tekst.indexOf("| Celwaarde |")).toBeLessThan(tekst.indexOf("Tekst na de tabel."));
  });

  it("dupliceert de eerste rij niet bij een tabel zonder <thead> (#2)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop>
      <table><tgroup cols="2"><tbody>
        <row><entry>r1c1</entry><entry>r1c2</entry></row>
        <row><entry>r2c1</entry><entry>r2c2</entry></row>
      </tbody></tgroup></table>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const tekst = parseBwb(xml, "BWBR12345", "Test Wet").mcpLite[0].tekst;
    const treffers = tekst.split("\n").filter((r) => r.includes("r1c1")).length;
    expect(treffers).toBe(1);
  });

  it("escapet pipe-tekens in tabelcellen (#4)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop>
      <table><tgroup cols="2"><tbody>
        <row><entry>a | b</entry><entry>c</entry></row>
      </tbody></tgroup></table>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const tekst = parseBwb(xml, "BWBR12345", "Test Wet").mcpLite[0].tekst;
    // De pipe in de cel is geëscaped, dus de rij blijft 2 kolommen (3 scheiders).
    expect(tekst).toContain("a \\| b");
    const dataRij = tekst.split("\n").find((r) => r.includes("a \\| b"))!;
    // Tel alleen niet-geëscapete pipes (de echte celscheiders): 2 kolommen → 3 scheiders.
    expect((dataRij.match(/(?<!\\)\|/g) ?? []).length).toBe(3);
  });

  it("expandeert colspan tot het juiste aantal kolommen (#4)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop>
      <table><tgroup cols="3">
        <colspec colname="c1"/><colspec colname="c2"/><colspec colname="c3"/>
        <tbody>
          <row><entry>H1</entry><entry>H2</entry><entry>H3</entry></row>
          <row><entry namest="c1" nameend="c2">breed</entry><entry>laatste</entry></row>
        </tbody>
      </tgroup></table>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const tekst = parseBwb(xml, "BWBR12345", "Test Wet").mcpLite[0].tekst;
    const breedRij = tekst.split("\n").find((r) => r.includes("breed"))!;
    // 3 kolommen → 4 pipe-scheiders, ook al levert de bron maar 2 cellen.
    expect(breedRij.split("|").length - 1).toBe(4);
  });

  it("scheidt meerdere <al>-blokken in één tabelcel (#9)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop>
      <table><tgroup cols="1"><tbody>
        <row><entry><al>regel een</al><al>regel twee</al></entry></row>
      </tbody></tgroup></table>
    </artikel>
  </wettekst></wetgeving>
</toestand>`;
    const tekst = parseBwb(xml, "BWBR12345", "Test Wet").mcpLite[0].tekst;
    expect(tekst).toContain("regel een regel twee");
    expect(tekst).not.toContain("regel eenregel twee");
  });

  it("behoudt tekst én pad van geneste circulaire.divisie ≥3 niveaus (#1, #3)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR0024096" inwerkingtreding="2008-01-01">
  <wetgeving><circulaire><circulaire-tekst>
    <circulaire.divisie bwb-ng-variabel-deel="1">
      <kop><label>Paragraaf</label><nr>1</nr><titel>Een</titel></kop>
      <tekst><al>Tekst niveau 1.</al></tekst>
      <circulaire.divisie bwb-ng-variabel-deel="1.1">
        <kop><label>Paragraaf</label><nr>1.1</nr><titel>Een-een</titel></kop>
        <tekst><al>Tekst niveau 1.1.</al></tekst>
        <circulaire.divisie bwb-ng-variabel-deel="1.1.1">
          <kop><label>Paragraaf</label><nr>1.1.1</nr><titel>Diep</titel></kop>
          <tekst><al>Tekst niveau 1.1.1 DIEP.</al></tekst>
        </circulaire.divisie>
      </circulaire.divisie>
    </circulaire.divisie>
  </circulaire-tekst></circulaire></wetgeving>
</toestand>`;
    const result = parseBwb(xml, "BWBR0024096", "Leidraad Invordering 2008");
    const alleTekst = result.mcpLite.map((n) => n.tekst).join("\n");
    // Geen tekstverlies op het diepste niveau.
    expect(alleTekst).toContain("Tekst niveau 1.1.1 DIEP.");
    // Het diepste niveau heeft een eigen node met volledig, leesbaar pad.
    const diep = result.mcpLite.find((n) => n.tekst.includes("DIEP"))!;
    expect(diep.sectie).toContain("Paragraaf 1.1.1 Diep");
    expect(diep.sectie).toContain("Paragraaf 1.1 Een-een");
    expect(diep.bronreferentie).toBe("jci1.3:c:BWBR0024096&artikel=1.1.1");
  });

  it("does not add trailing dots to dash list labels", () => {
    const dashListXml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR12345">
  <wetgeving>
    <wettekst>
      <artikel>
        <kop><nr>1</nr></kop>
        <lijst>
          <li>
            <li.nr>–</li.nr>
            <al>Streepje item</al>
          </li>
        </lijst>
      </artikel>
    </wettekst>
  </wetgeving>
</toestand>`;

    const result = parseBwb(dashListXml, "BWBR12345", "Test Wet");
    const node = result.mcpLite[0];
    
    // Should contain "– Streepje item", NOT "–. Streepje item"
    expect(node.tekst).toContain("– Streepje item");
    expect(node.tekst).not.toContain("–. Streepje item");
  });
});
