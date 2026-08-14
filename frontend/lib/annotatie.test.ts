import { describe, expect, it } from "vitest";
import {
  documentStatusLabel,
  pastInFilter,
  sorteerReview,
  volgendeElement,
  gewijzigdeVelden,
  overlaptSelectie,
  redenVoorWijziging,
  kandidaatLabel,
  kandidaatPrompt,
  kandidatenAlsTekst,
  mergeVoorstellen,
} from "./annotatie";
import type { AnnotatieElement, VoorstelElement } from "./types";

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

// --- de reden hoeft niet meer gevraagd te worden ------------------------------------------------

const ELEMENT = {
  id: "el-1",
  klasse: "Rechtsobject",
  tekst: "belastingaanslag",
  lid: "1",
  toelichting: "het object",
  vindplaats: "",
  herkomst: "agent",
  gewijzigd_door: "",
  lifecycle: "voorgesteld",
  alternatieven: [],
  aandacht: null,
  critic: "",
  critic_rondes: [],
  critic_suggestie: null,
  anker: null,
  diff: {},
  beslissingen: [],
} as unknown as AnnotatieElement;

describe("redenVoorWijziging", () => {
  it("leidt de reden af uit het veld dat veranderde", () => {
    expect(redenVoorWijziging(ELEMENT, { tekst: "een belastingaanslag" })).toBe("tekst");
    expect(redenVoorWijziging(ELEMENT, { klasse: "Rechtssubject" })).toBe("verkeerde_klasse");
    expect(redenVoorWijziging(ELEMENT, { toelichting: "toch iets anders" })).toBe("interpretatie");
  });

  it("valt op 'anders' terug als er meer dan één veld wijzigt", () => {
    expect(redenVoorWijziging(ELEMENT, { tekst: "aanslag", klasse: "Rechtssubject" })).toBe("anders");
  });

  it("telt een veld dat gelijk blijft niet mee", () => {
    // Anders zou een klasse-wijziging waarbij de tekst wordt meegestuurd 'anders' opleveren.
    const w = { tekst: ELEMENT.tekst, klasse: "Rechtssubject" };
    expect(gewijzigdeVelden(ELEMENT, w)).toEqual(["klasse"]);
    expect(redenVoorWijziging(ELEMENT, w)).toBe("verkeerde_klasse");
  });

  it("ziet niets te doen als er niets verandert", () => {
    expect(gewijzigdeVelden(ELEMENT, { klasse: ELEMENT.klasse, tekst: ELEMENT.tekst })).toEqual([]);
  });

  it("beschouwt een lege toelichting als een wijziging", () => {
    // Wissen is ook een keuze; het mag alleen niet ongemerkt gebeuren (daar zit de tweede klik).
    expect(gewijzigdeVelden(ELEMENT, { toelichting: "" })).toEqual(["toelichting"]);
  });
});

describe("overlaptSelectie", () => {
  const bereik = { start: 10, eind: 26 };

  it("herkent een selectie die het fragment raakt", () => {
    expect(overlaptSelectie({ start: 6, eind: 26 }, bereik)).toBe(true);   // uitbreiden naar links
    expect(overlaptSelectie({ start: 10, eind: 20 }, bereik)).toBe(true);  // inkorten
    expect(overlaptSelectie({ start: 26, eind: 40 }, bereik)).toBe(true);  // sluit erop aan
  });

  it("herkent een selectie die er los van staat", () => {
    expect(overlaptSelectie({ start: 0, eind: 9 }, bereik)).toBe(false);
    expect(overlaptSelectie({ start: 27, eind: 40 }, bereik)).toBe(false);
  });
});

// --- de lijst ordenen -----------------------------------------------------------------------------

function el(id: string, extra: Partial<AnnotatieElement> = {}): AnnotatieElement {
  return { ...ELEMENT, id, ...extra } as AnnotatieElement;
}

describe("sorteerReview", () => {
  it("zet te beoordelen vóór beslist", () => {
    const lijst = [el("a", { lifecycle: "human_approved" }), el("b"), el("c", { lifecycle: "rejected" })];
    expect(sorteerReview(lijst).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("zet rood vóór geel vóór groen vóór geen oordeel", () => {
    const lijst = [el("geen"), el("groen", { aandacht: "groen" }), el("rood", { aandacht: "rood" }),
                   el("geel", { aandacht: "geel" })];
    expect(sorteerReview(lijst).map((e) => e.id)).toEqual(["rood", "geel", "groen", "geen"]);
  });

  it("is stabiel: gelijke sleutels houden hun volgorde in de tekst", () => {
    // Anders verspringen kaarten onder je handen zodra er iets verandert.
    const lijst = [el("1"), el("2"), el("3")];
    expect(sorteerReview(lijst).map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("laat de invoer ongemoeid", () => {
    const lijst = [el("a", { aandacht: "groen" }), el("b", { aandacht: "rood" })];
    sorteerReview(lijst);
    expect(lijst.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("pastInFilter", () => {
  it("filtert op te beoordelen", () => {
    expect(pastInFilter(el("a"), "te_beoordelen")).toBe(true);
    expect(pastInFilter(el("b", { lifecycle: "human_approved" }), "te_beoordelen")).toBe(false);
  });

  it("filtert op aandacht — groen telt niet mee", () => {
    expect(pastInFilter(el("r", { aandacht: "rood" }), "aandacht")).toBe(true);
    expect(pastInFilter(el("g", { aandacht: "groen" }), "aandacht")).toBe(false);
    expect(pastInFilter(el("x"), "aandacht")).toBe(false);
  });

  it("laat bij 'alles' alles door", () => {
    expect(pastInFilter(el("b", { lifecycle: "rejected" }), "alles")).toBe(true);
  });
});

describe("volgendeElement", () => {
  const lijst = [el("1"), el("2", { lifecycle: "human_approved" }), el("3")];

  it("loopt vooruit en achteruit door de lijst", () => {
    expect(volgendeElement(lijst, "1")?.id).toBe("2");
    expect(volgendeElement(lijst, "2", -1)?.id).toBe("1");
  });

  it("stopt aan het eind in plaats van rond te lopen", () => {
    // Rondlopen laat je onbedoeld een tweede ronde beginnen zonder dat je het doorhebt.
    expect(volgendeElement(lijst, "3")).toBeUndefined();
    expect(volgendeElement(lijst, "1", -1)).toBeUndefined();
  });

  it("begint bij de rand als er niets geselecteerd is", () => {
    expect(volgendeElement(lijst, undefined)?.id).toBe("1");
    expect(volgendeElement(lijst, undefined, -1)?.id).toBe("3");
  });

  it("slaat bij auto-advance de beslist-elementen over", () => {
    expect(volgendeElement(lijst, "1", 1, true)?.id).toBe("3");
  });

  it("geeft niets terug als de lijst leeg is", () => {
    expect(volgendeElement([], undefined)).toBeUndefined();
  });
});
