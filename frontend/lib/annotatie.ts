import type { AgentKandidaat, DocumentStatus, VoorstelElement } from "./types";

// Presentatie-helpers voor de annotatie-workbench (statuslabels/kleuren).

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  in_review: "In behandeling",
  geaccordeerd: "Geaccordeerd",
  gepromoveerd: "In de graaf",
};

// Badge-tone per status (via de design-tokens, geen losse hex): in behandeling = aandacht-oker,
// geaccordeerd = aandacht-groen, in de graaf = lintblauw.
export const DOCUMENT_STATUS_STYLE: Record<DocumentStatus, string> = {
  in_review: "bg-aandacht-geel-bg text-aandacht-geel-tekst border-aandacht-geel-rand",
  geaccordeerd: "bg-aandacht-groen-bg text-aandacht-groen-tekst border-aandacht-groen-rand",
  gepromoveerd: "bg-lint/10 text-lint border-lint/25",
};

export function documentStatusLabel(status: DocumentStatus): string {
  return DOCUMENT_STATUS_LABEL[status] ?? status;
}

/** Voeg een binnenkomend `element`-event samen met wat er al verzameld is.
 *
 *  De agent kan hetzelfde element in meerdere rondes opnieuw sturen (annoteerder ⇄ Critic). Zonder
 *  ontdubbelen zou de werkplek dan duplicaten tonen én naar de server sturen. Matcht op `id`, met
 *  dezelfde terugval als de server (genormaliseerde tekst + lid) voor voorstellen zonder id.
 *  De laatste versie wint: die is door de meest recente Critic-ronde gegaan.
 */
export function mergeVoorstellen(
  bestaand: VoorstelElement[],
  binnen: VoorstelElement,
): VoorstelElement[] {
  const sleutel = (e: VoorstelElement) =>
    e.id ? `id:${e.id}` : `t:${e.tekst.split(/\s+/).join(" ").toLowerCase()}|${e.lid ?? ""}`;
  const doel = sleutel(binnen);
  const index = bestaand.findIndex((e) => sleutel(e) === doel);
  if (index < 0) return [...bestaand, binnen];
  const kopie = [...bestaand];
  kopie[index] = binnen;
  return kopie;
}

/** Mensleesbare aanduiding van een kandidaat-bepaling ("Artikel 36a, lid 1 — Invorderingswet 1990"). */
export function kandidaatLabel(k: AgentKandidaat): string {
  const bepaling = `Artikel ${k.artikel}${k.lid ? `, lid ${k.lid}` : ""}`;
  return k.citeertitel ? `${bepaling} — ${k.citeertitel}` : bepaling;
}

/** De opdracht die volgt als de jurist een kandidaat kiest.
 *
 *  Het bwbId gaat mee omdat de ophaal-agent anders opnieuw moet zoeken op de citeertitel — en dan
 *  bij een andere bepaling kan uitkomen dan die de jurist aanwees.
 */
export function kandidaatPrompt(k: AgentKandidaat): string {
  const bepaling = `artikel ${k.artikel}${k.lid ? ` lid ${k.lid}` : ""}`;
  const regeling = k.citeertitel ? `${k.citeertitel} (${k.bwbId})` : k.bwbId;
  return `Annoteer ${bepaling} van de ${regeling}.`;
}

/** De keuze als tekst, zodat de thread na herladen nog laat zien wát er te kiezen viel.
 *
 *  De kandidaten zelf zijn geen onderdeel van het berichtcontract van de api; alleen deze tekst
 *  wordt bewaard. Zonder dit leest een herladen gesprek als "Ik vond 5 bepalingen" zonder welke.
 */
export function kandidatenAlsTekst(melding: string, kandidaten: AgentKandidaat[]): string {
  const regels = kandidaten.map((k) => `- ${kandidaatLabel(k)}`);
  return [melding.trim(), ...regels].filter(Boolean).join("\n");
}
