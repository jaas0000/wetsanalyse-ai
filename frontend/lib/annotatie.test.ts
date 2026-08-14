import { describe, expect, it } from "vitest";
import {
  documentStatusLabel,
  kandidaatLabel,
  kandidaatPrompt,
  kandidatenAlsTekst,
  mergeVoorstellen,
} from "./annotatie";
import type { VoorstelElement } from "./types";

describe("documentStatusLabel", () => {
  it("mapt de drie documentstatussen naar NL-labels", () => {
    expect(documentStatusLabel("in_review")).toBe("In behandeling");
    expect(documentStatusLabel("geaccordeerd")).toBe("Geaccordeerd");
    expect(documentStatusLabel("gepromoveerd")).toBe("In de graaf");
  });
});

function voorstel(over: Partial<VoorstelElement> = {}): VoorstelElement {
  return {
    klasse: "Voorwaarde",
    tekst: "indien betaling uitblijft",
    lid: "1",
    toelichting: "",
    vindplaats: "",
    alternatieven: [],
    grounded: true,
    ...over,
  };
}

// De agent stuurt hetzelfde element opnieuw zodra de Critic om een herziening vraagt. Zonder
// ontdubbelen zou de werkplek dubbele kaarten tonen én dubbel naar de server sturen.
describe("mergeVoorstellen", () => {
  it("voegt een onbekend element toe", () => {
    const uit = mergeVoorstellen([], voorstel({ id: "a1" }));
    expect(uit).toHaveLength(1);
  });

  it("vervangt op id — de laatste ronde wint", () => {
    const eerst = mergeVoorstellen([], voorstel({ id: "a1", klasse: "Rechtsfeit" }));
    const na = mergeVoorstellen(eerst, voorstel({ id: "a1", klasse: "Voorwaarde", aandacht: "groen" }));
    expect(na).toHaveLength(1);
    expect(na[0].klasse).toBe("Voorwaarde");
    expect(na[0].aandacht).toBe("groen");
  });

  it("houdt verschillende id's uit elkaar", () => {
    let uit = mergeVoorstellen([], voorstel({ id: "a1" }));
    uit = mergeVoorstellen(uit, voorstel({ id: "a2", tekst: "de ontvanger" }));
    expect(uit).toHaveLength(2);
  });

  it("valt zonder id terug op tekst en lid, net als de server", () => {
    const eerst = mergeVoorstellen([], voorstel({ toelichting: "eerste" }));
    // Zelfde tekst (andere spatiëring/kapitalisatie) en lid → hetzelfde element.
    const na = mergeVoorstellen(eerst, voorstel({ tekst: "Indien  betaling   uitblijft", toelichting: "beter" }));
    expect(na).toHaveLength(1);
    expect(na[0].toelichting).toBe("beter");
  });

  it("ziet hetzelfde fragment in een ander lid als een apart element", () => {
    const eerst = mergeVoorstellen([], voorstel({ lid: "1" }));
    const na = mergeVoorstellen(eerst, voorstel({ lid: "2" }));
    expect(na).toHaveLength(2);
  });

  it("laat een element met id ongemoeid bij een naamloos voorstel met dezelfde tekst", () => {
    // Een voorstel mét id en één zonder zijn niet zomaar hetzelfde: het id is leidend.
    const eerst = mergeVoorstellen([], voorstel({ id: "a1" }));
    const na = mergeVoorstellen(eerst, voorstel({}));
    expect(na).toHaveLength(2);
  });
});

describe("kandidaten bij een onderwerp-vraag", () => {
  const k = { bwbId: "BWBR0004770", artikel: "36a", lid: "1", citeertitel: "Invorderingswet 1990" };

  it("noemt lid alleen als er een lid is", () => {
    expect(kandidaatLabel(k)).toBe("Artikel 36a, lid 1 — Invorderingswet 1990");
    expect(kandidaatLabel({ bwbId: "BWBR1", artikel: "36" })).toBe("Artikel 36");
  });

  it("zet het bwbId in de vervolgopdracht", () => {
    // Zonder bwbId moet de ophaal-agent opnieuw zoeken op de citeertitel — en kan hij bij een
    // andere bepaling uitkomen dan die de jurist aanwees.
    expect(kandidaatPrompt(k)).toContain("BWBR0004770");
    expect(kandidaatPrompt(k)).toContain("artikel 36a lid 1");
  });

  it("bewaart de keuze leesbaar voor na een herlaadbeurt", () => {
    const tekst = kandidatenAlsTekst("Ik vond 2 bepalingen.", [k, { bwbId: "BWBR1", artikel: "36" }]);
    expect(tekst.split("\n")).toHaveLength(3);
    expect(tekst).toContain("- Artikel 36a, lid 1 — Invorderingswet 1990");
  });
});
