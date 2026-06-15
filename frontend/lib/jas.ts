// De dertien JAS-klassen (zie references/jas-klassen-referentie.md) met een vaste,
// onderscheidende badge-kleur per klasse. Onbekende klassen vallen terug op "neutraal".

export const JAS_KLASSEN = [
  "Rechtssubject",
  "Rechtsobject",
  "Rechtsbetrekking",
  "Rechtsfeit",
  "Voorwaarde",
  "Afleidingsregel",
  "Variabele en variabelewaarde",
  "Parameter en parameterwaarde",
  "Operator",
  "Tijdsaanduiding",
  "Plaatsaanduiding",
  "Delegatiebevoegdheid en delegatie-invulling",
  "Brondefinitie",
] as const;

// Tailwind-klassen per JAS-klasse (achtergrond + tekst + rand). Onderling onderscheidende,
// op lintblauw afgestemde koele tinten (Rijkshuisstijl); donkere tekst ≥ 4,5:1 op de tint.
const KLASSE_STYLE: Record<string, string> = {
  Rechtssubject: "bg-[#e7eef5] text-[#154273] border-[#bcd2e6]",
  Rechtsobject: "bg-[#e2f0ef] text-[#1c5450] border-[#b4d8d3]",
  Rechtsbetrekking: "bg-[#eae9f3] text-[#3b3a6e] border-[#c8c6e3]",
  Rechtsfeit: "bg-[#fbe7e5] text-[#8e2018] border-[#f0bcb6]",
  Voorwaarde: "bg-[#e6f0e0] text-[#2c6608] border-[#bcd9a8]",
  Afleidingsregel: "bg-[#e4eef2] text-[#1f4a5a] border-[#bcd6e0]",
  "Variabele en variabelewaarde": "bg-[#f6ecde] text-[#7a4d00] border-[#e6cfa8]",
  "Parameter en parameterwaarde": "bg-[#f0e9f2] text-[#5a3a5e] border-[#ddc8e0]",
  Operator: "bg-[#efe9e0] text-[#5e4a2a] border-[#d8ccb4]",
  Tijdsaanduiding: "bg-[#e2eff2] text-[#1c5260] border-[#b4d8e0]",
  Plaatsaanduiding: "bg-[#eaf0e0] text-[#4a5a1f] border-[#d0dcb0]",
  "Delegatiebevoegdheid en delegatie-invulling": "bg-[#f3e7ee] text-[#6e2a4a] border-[#e3bcd0]",
  Brondefinitie: "bg-[#e9ebf2] text-[#353f5e] border-[#c8cce0]",
};

const NEUTRAAL = "bg-surface text-muted border-line";

export function jasStyle(klasse: string): string {
  return KLASSE_STYLE[klasse?.trim()] ?? NEUTRAAL;
}

export function isBekendeKlasse(klasse: string): boolean {
  return klasse?.trim() in KLASSE_STYLE;
}
