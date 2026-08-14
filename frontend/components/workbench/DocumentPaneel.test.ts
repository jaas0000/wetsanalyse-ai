import { describe, expect, it } from "vitest";

import { segmenteer } from "./DocumentPaneel";

const BRON = "De ontvanger kan uitstel van betaling verlenen aan de belastingschuldige.";

describe("segmenteer — brongetrouwe highlighting", () => {
  it("markeert letterlijke fragmenten met hun klasse, in tekstvolgorde", () => {
    const segs = segmenteer(BRON, [
      { id: "a", klasse: "Rechtssubject", tekst: "De ontvanger" },
      { id: "b", klasse: "Rechtsbetrekking", tekst: "kan uitstel van betaling verlenen" },
    ]);
    const gemarkeerd = segs.filter((s) => s.klasse);
    expect(gemarkeerd.map((s) => s.tekst)).toEqual([
      "De ontvanger",
      "kan uitstel van betaling verlenen",
    ]);
    expect(gemarkeerd.map((s) => s.klasse)).toEqual(["Rechtssubject", "Rechtsbetrekking"]);
    // de volledige tekst blijft behouden (som van de segmenten == bron)
    expect(segs.map((s) => s.tekst).join("")).toBe(BRON);
  });

  it("markeert een niet-gevonden fragment niet", () => {
    const segs = segmenteer(BRON, [{ klasse: "Rechtssubject", tekst: "komt niet voor" }]);
    expect(segs.some((s) => s.klasse)).toBe(false);
  });

  it("laat het langste fragment winnen bij overlap (geen dubbel-markering)", () => {
    const segs = segmenteer(BRON, [
      { klasse: "Rechtsbetrekking", tekst: "kan uitstel van betaling verlenen" },
      { klasse: "Rechtsobject", tekst: "uitstel van betaling" }, // valt binnen het langere
    ]);
    const gemarkeerd = segs.filter((s) => s.klasse);
    expect(gemarkeerd).toHaveLength(1);
    expect(gemarkeerd[0].klasse).toBe("Rechtsbetrekking");
  });
});

// --- ankers: twee identieke fragmenten uit elkaar houden, en de jurist wint bij overlap ---------

import { maakAnker } from "@/lib/selectie";

const HERHAALD = "De ontvanger verleent uitstel. De ontvanger kan dat weigeren.";

describe("segmenteer — ankers", () => {
  it("gebruikt het anker om het juiste voorkomen te kiezen", () => {
    // Zonder anker zou "De ontvanger" altijd op positie 0 landen; het anker wijst de tweede aan.
    const tweede = HERHAALD.indexOf("De ontvanger", 1);
    const segs = segmenteer(HERHAALD, [
      { id: "b", klasse: "Rechtssubject", tekst: "De ontvanger",
        anker: maakAnker(HERHAALD, tweede, tweede + 12) },
    ]);
    const voorAf = segs.slice(0, segs.findIndex((s) => s.klasse)).map((s) => s.tekst).join("");
    expect(voorAf.length).toBe(tweede);
  });

  it("markeert twee identieke fragmenten allebei, elk op hun eigen plek", () => {
    const eerste = 0;
    const tweede = HERHAALD.indexOf("De ontvanger", 1);
    const segs = segmenteer(HERHAALD, [
      { id: "a", klasse: "Rechtssubject", tekst: "De ontvanger", anker: maakAnker(HERHAALD, eerste, 12) },
      { id: "b", klasse: "Rechtssubject", tekst: "De ontvanger",
        anker: maakAnker(HERHAALD, tweede, tweede + 12) },
    ]);
    expect(segs.filter((s) => s.klasse)).toHaveLength(2);
    expect(segs.map((s) => s.tekst).join("")).toBe(HERHAALD);
  });

  it("valt terug op de omringende tekst als de bron is geschoven", () => {
    // Het anker komt van een oudere versie van de tekst: de hash klopt niet meer en de offsets
    // wijzen naar de verkeerde plek. De context moet het dan alsnog goed krijgen.
    const oud = "Inleiding. " + HERHAALD;
    // let op: lastIndexOf — met indexOf(…, 1) pak je in `oud` nog steeds het EERSTE voorkomen,
    // want "Inleiding. " schuift alles 11 tekens op.
    const tweedeOud = oud.lastIndexOf("De ontvanger");
    const verouderd = maakAnker(oud, tweedeOud, tweedeOud + 12);

    const segs = segmenteer(HERHAALD, [
      { id: "b", klasse: "Rechtssubject", tekst: "De ontvanger", anker: verouderd },
    ]);
    const voorAf = segs.slice(0, segs.findIndex((s) => s.klasse)).map((s) => s.tekst).join("");
    expect(voorAf.length).toBe(HERHAALD.indexOf("De ontvanger", 1));
  });

  it("laat de jurist winnen bij overlap met een agent-voorstel", () => {
    const segs = segmenteer(BRON, [
      { id: "agent", klasse: "Rechtsbetrekking", tekst: "kan uitstel van betaling verlenen",
        herkomst: "agent" },
      { id: "mens", klasse: "Rechtsobject", tekst: "uitstel van betaling", herkomst: "mens" },
    ]);
    const gemarkeerd = segs.filter((s) => s.klasse);
    expect(gemarkeerd).toHaveLength(1);
    expect(gemarkeerd[0].id).toBe("mens");
    expect(gemarkeerd[0].herkomst).toBe("mens");
  });

  it("houdt het bestaande gedrag aan zonder ankers", () => {
    const segs = segmenteer(BRON, [
      { id: "a", klasse: "Rechtssubject", tekst: "De ontvanger" },
      { id: "b", klasse: "Rechtsbetrekking", tekst: "kan uitstel van betaling verlenen" },
    ]);
    expect(segs.filter((s) => s.klasse).map((s) => s.id)).toEqual(["a", "b"]);
  });
});


// --- focus: een markering binnen een langere markering zichtbaar maken -------------------------

describe("segmenteer — focus op één markering", () => {
  const ZIN = "De ontvanger kan uitstel van betaling verlenen aan de belastingschuldige.";
  const ELEMENTEN = [
    { id: "lang", klasse: "Afleidingsregel", tekst: ZIN },
    { id: "kort", klasse: "Rechtsobject", tekst: "uitstel van betaling" },
  ];

  it("toont zonder focus alleen de langste — dat is precies het probleem", () => {
    const gemarkeerd = segmenteer(ZIN, ELEMENTEN).filter((s) => s.klasse);
    expect(gemarkeerd.map((s) => s.id)).toEqual(["lang"]);
  });

  it("toont met focus alleen de geselecteerde, ook als die binnen een langere valt", () => {
    const gemarkeerd = segmenteer(ZIN, ELEMENTEN, "kort").filter((s) => s.klasse);
    expect(gemarkeerd.map((s) => s.id)).toEqual(["kort"]);
    expect(gemarkeerd[0].tekst).toBe("uitstel van betaling");
  });

  it("houdt de tekst intact in focus", () => {
    expect(segmenteer(ZIN, ELEMENTEN, "kort").map((s) => s.tekst).join("")).toBe(ZIN);
  });

  it("valt terug op alles als het actieve id niet (meer) bestaat", () => {
    // Bv. na een intrekking: liever alle markeringen dan een lege tekst.
    const gemarkeerd = segmenteer(ZIN, ELEMENTEN, "weg").filter((s) => s.klasse);
    expect(gemarkeerd.map((s) => s.id)).toEqual(["lang"]);
  });
});
