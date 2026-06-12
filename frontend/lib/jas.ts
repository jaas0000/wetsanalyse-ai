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

// Tailwind-klassen per JAS-klasse (achtergrond + tekst + rand). Gedempte, archief-achtige tinten.
const KLASSE_STYLE: Record<string, string> = {
  Rechtssubject: "bg-[#e7eef0] text-[#274a52] border-[#bcd2d7]",
  Rechtsobject: "bg-[#efeae0] text-[#5a4a2a] border-[#d8ccb0]",
  Rechtsbetrekking: "bg-[#eae6f0] text-[#473a5e] border-[#cdc2dd]",
  Rechtsfeit: "bg-[#f0e7e7] text-[#6b3030] border-[#dcc2c2]",
  Voorwaarde: "bg-[#e8efe6] text-[#3a522f] border-[#c8dcc0]",
  Afleidingsregel: "bg-[#e6edf0] text-[#2f4a5a] border-[#c0d2dc]",
  "Variabele en variabelewaarde": "bg-[#f0ece4] text-[#574a35] border-[#dad0bf]",
  "Parameter en parameterwaarde": "bg-[#ece8f0] text-[#4a3f5e] border-[#d2c8dd]",
  Operator: "bg-[#f0eae6] text-[#5e4435] border-[#ddccc0]",
  Tijdsaanduiding: "bg-[#e6eff0] text-[#2f5258] border-[#c0d8dc]",
  Plaatsaanduiding: "bg-[#eaf0e6] text-[#3f5230] border-[#cedcc0]",
  "Delegatiebevoegdheid en delegatie-invulling": "bg-[#f0e8ea] text-[#5e3542] border-[#ddc4cc]",
  Brondefinitie: "bg-[#e7e9f0] text-[#393f5e] border-[#c4c9dd]",
};

const NEUTRAAL = "bg-faint text-muted border-line";

export function jasStyle(klasse: string): string {
  return KLASSE_STYLE[klasse?.trim()] ?? NEUTRAAL;
}

export function isBekendeKlasse(klasse: string): boolean {
  return klasse?.trim() in KLASSE_STYLE;
}
