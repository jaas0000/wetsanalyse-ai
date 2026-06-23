import { describe, it, expect } from "vitest";
import { parseBwbXml, normalizeNode } from "../bwb-parser/index.js";
import { bouwStructuurNodes } from "./structuur.js";
import type { StructuurNode } from "../shared/schemas.js";

/** Bouw de structuurhiërarchie zoals handleStructuur dat doet, maar zonder netwerk. */
function structuurVan(xml: string): StructuurNode[] {
  return bouwStructuurNodes(normalizeNode(parseBwbXml(xml, "BWBR9999")));
}

function zoekSectie(nodes: StructuurNode[], type: string, nr: string): StructuurNode | undefined {
  return nodes.find((n) => n.type === type && n.nr === nr);
}

describe("bouwStructuurNodes — bijlage en divisie als container", () => {
  // Een hoofdstuk (klassieke container) náást een bijlage met een direct artikel en een
  // geneste divisie. Zonder bijlage/divisie in CONTAINER_TYPES zou de bijlage als
  // transparante wrapper worden behandeld: de kop verdwijnt en artikel "A1" (direct onder
  // de bijlage) gaat verloren.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR9999">
  <wetgeving>
    <wettekst>
      <hoofdstuk>
        <kop><nr>1</nr><titel>Algemeen</titel></kop>
        <artikel><kop><nr>1</nr></kop></artikel>
      </hoofdstuk>
    </wettekst>
    <bijlage>
      <kop><nr>A</nr><titel>Modellen</titel></kop>
      <artikel><kop><nr>A1</nr></kop></artikel>
      <divisie>
        <kop><nr>A.1</nr><titel>Subdeel</titel></kop>
        <artikel><kop><nr>A2</nr></kop></artikel>
      </divisie>
    </bijlage>
  </wetgeving>
</toestand>`;

  const structuur = structuurVan(xml);

  it("toont het gewone hoofdstuk met zijn artikel", () => {
    const hfd = zoekSectie(structuur, "hoofdstuk", "1");
    expect(hfd).toBeDefined();
    expect(hfd?.artikelen).toEqual(["1"]);
  });

  it("toont de bijlage als sectie met kop én het direct eronder hangende artikel", () => {
    const bijlage = zoekSectie(structuur, "bijlage", "A");
    expect(bijlage).toBeDefined();
    expect(bijlage?.titel).toBe("Modellen");
    expect(bijlage?.artikelen).toEqual(["A1"]);
  });

  it("behoudt de geneste divisie-hiërarchie binnen de bijlage (geen platslaan)", () => {
    const bijlage = zoekSectie(structuur, "bijlage", "A");
    const divisie = bijlage?.secties && zoekSectie(bijlage.secties, "divisie", "A.1");
    expect(divisie).toBeDefined();
    expect(divisie?.titel).toBe("Subdeel");
    expect(divisie?.artikelen).toEqual(["A2"]);
  });

  it("laat geen enkel artikel uit de bijlage verdwijnen", () => {
    const alleArtikelen = JSON.stringify(structuur);
    expect(alleArtikelen).toContain("A1");
    expect(alleArtikelen).toContain("A2");
  });
});

describe("bouwStructuurNodes — geneste circulaire.divisie (Leidraad)", () => {
  // Een circulaire met circulaire-tekst → circulaire.divisie[], waarbij bepaling "9"
  // zelf geneste sub-divisies (9.1 → 9.1.1, en 9.2) draagt en bepaling "1" een leaf is.
  // Zonder sub-divisie-traversal zou alleen "9" als platte artikelstring verschijnen en
  // zouden 9.1/9.1.1/9.2 volledig verdwijnen uit de inhoudsopgave.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<toestand bwb-id="BWBR9999">
  <circulaire>
    <circulaire-tekst>
      <circulaire.divisie>
        <kop><label>Artikel</label><nr>9</nr><titel>Betalingstermijnen</titel></kop>
        <tekst><al>Inleidende tekst van artikel 9.</al></tekst>
        <circulaire.divisie>
          <kop><nr>9.1</nr><titel>Afwijking</titel></kop>
          <tekst><al>Tekst van 9.1.</al></tekst>
          <circulaire.divisie>
            <kop><nr>9.1.1</nr><titel>Detail</titel></kop>
            <tekst><al>Tekst van 9.1.1.</al></tekst>
          </circulaire.divisie>
        </circulaire.divisie>
        <circulaire.divisie>
          <kop><nr>9.2</nr><titel>Tweede</titel></kop>
          <tekst><al>Tekst van 9.2.</al></tekst>
        </circulaire.divisie>
      </circulaire.divisie>
      <circulaire.divisie>
        <kop><label>Artikel</label><nr>1</nr><titel>Inleiding</titel></kop>
        <tekst><al>Leaf-bepaling zonder sub-divisies.</al></tekst>
      </circulaire.divisie>
    </circulaire-tekst>
  </circulaire>
</toestand>`;

  const structuur = structuurVan(xml);
  const circTekst = structuur.find((n) => n.type === "circulaire-tekst");

  it("toont een leaf-divisie (zonder sub-divisies) als platte artikelstring", () => {
    expect(circTekst).toBeDefined();
    expect(circTekst?.artikelen).toEqual(["1"]);
  });

  it("toont een divisie mét sub-divisies als eigen sectie (niet als platte artikelstring)", () => {
    expect(circTekst?.artikelen).not.toContain("9");
    const divisie9 = circTekst?.secties && zoekSectie(circTekst.secties, "circulaire_divisie", "9");
    expect(divisie9).toBeDefined();
    expect(divisie9?.titel).toBe("Betalingstermijnen");
    // Leaf-sub-divisie 9.2 hangt direct onder 9 als artikelstring.
    expect(divisie9?.artikelen).toEqual(["9.2"]);
  });

  it("behoudt de geneste sub-divisies (9.1 → 9.1.1) recursief", () => {
    const divisie9 = circTekst?.secties && zoekSectie(circTekst.secties, "circulaire_divisie", "9");
    const divisie91 = divisie9?.secties && zoekSectie(divisie9.secties, "circulaire_divisie", "9.1");
    expect(divisie91).toBeDefined();
    expect(divisie91?.titel).toBe("Afwijking");
    expect(divisie91?.artikelen).toEqual(["9.1.1"]);
  });

  it("laat geen enkel sub-divisie-niveau verdwijnen", () => {
    const alles = JSON.stringify(structuur);
    expect(alles).toContain("9.1");
    expect(alles).toContain("9.1.1");
    expect(alles).toContain("9.2");
  });
});
