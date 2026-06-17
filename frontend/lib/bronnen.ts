// Presentatie-helpers voor het werkgebied/bronnen-model. Eén plek voor bron-labels,
// vindplaats-rendering en de wet-afleiding voor filters.

import type { Bron, BronInput, BronRef, Vindplaats } from "./types";

type LabelbareBron = { bwbId?: string | null; artikel?: string; lid?: string | null; label?: string };

/** Leesbaar label voor een bron: het expliciete label, of een afleiding uit wet/artikel/lid. */
export function bronLabel(b: LabelbareBron): string {
  if (b.label) return b.label;
  const lid = b.lid ? ` lid ${b.lid}` : "";
  return `${b.bwbId || ""} art. ${b.artikel || ""}${lid}`.trim();
}

/** Korte samenvatting van het werkgebied voor kaarten/lijsten. */
export function bronnenSamenvatting(bronnen: BronInput[] | undefined): string {
  const n = bronnen?.length ?? 0;
  if (n === 0) return "geen bronnen";
  if (n === 1) return bronLabel(bronnen![0]);
  return `${n} bronnen`;
}

/** bron_id → leesbaar label, voor het renderen van cross-bron vindplaatsen (act-3). */
export function bronLabelMap(bronnen: (Bron | BronRef)[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of bronnen || []) map[b.bron_id] = b.label || b.bron_id;
  return map;
}

/** Render een vindplaatsen-lijst als "Label lid n; Label lid m" met de bron-labels. */
export function vindplaatsText(
  vps: Vindplaats[] | undefined,
  labels: Record<string, string>,
): string {
  if (!vps || !vps.length) return "";
  return vps
    .map((vp) => `${labels[vp.bron_id] || vp.bron_id}${vp.lid ? ` lid ${vp.lid}` : ""}`)
    .filter(Boolean)
    .join("; ");
}

/** Unieke BWB-id's over alle bronnen van alle projecten — voor de wet-dropdown. */
export function distinctBwbIds(lijsten: (BronInput[] | undefined)[]): string[] {
  const s = new Set<string>();
  for (const list of lijsten) for (const b of list || []) if (b.bwbId) s.add(b.bwbId);
  return [...s].sort();
}
