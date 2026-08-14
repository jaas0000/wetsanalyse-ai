import type {
  AgentKandidaat,
  AnnotatieElement,
  DocumentStatus,
  ReviewReason,
  VoorstelElement,
  Wijziging,
} from "./types";

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

/** Welke velden wijzigt deze `Wijziging` werkelijk? Leeg = niets te versturen. */
export function gewijzigdeVelden(el: AnnotatieElement, w: Wijziging): (keyof Wijziging)[] {
  return (["klasse", "tekst", "toelichting", "lid"] as const).filter(
    (veld) => w[veld] != null && w[veld] !== el[veld],
  );
}

/** De reden bij een edit, afgeleid uit wát er veranderde.
 *
 *  De jurist vragen wat hij zojuist deed is dubbelop: het staat al in de wijziging. Dit haalt de
 *  `review_reason`-dropdown uit het bewerk-pad. Bij verwerpen blijft de reden wél een vraag — dat is
 *  informatie die alleen de mens heeft.
 */
export function redenVoorWijziging(el: AnnotatieElement, w: Wijziging): ReviewReason {
  const velden = gewijzigdeVelden(el, w);
  if (velden.length > 1) return "anders";
  switch (velden[0]) {
    case "tekst":
      return "tekst";
    case "klasse":
      return "verkeerde_klasse";
    case "toelichting":
      return "interpretatie";
    default:
      // Alleen het lid, of niets: geen van de vaste redenen dekt dat.
      return "anders";
  }
}

/** Raakt een selectie het bereik van de actieve markering?
 *
 *  Zo ja, dan pas je die markering aan in plaats van een tweede te maken. Aanraken op de rand telt
 *  mee (`eind === start`): uitbreiden begint per definitie waar de markering ophoudt.
 */
export function overlaptSelectie(
  selectie: { start: number; eind: number },
  bereik: { start: number; eind: number },
): boolean {
  return selectie.start <= bereik.eind && selectie.eind >= bereik.start;
}

// --- de reviewlijst ordenen -----------------------------------------------------------------------

/** Elementen waar de jurist al over besloten heeft. Ook `edited`: een aanpassing ís een besluit. */
export const BESLIST_LIFECYCLES = ["human_approved", "edited", "rejected"];

export type ReviewFilter = "alles" | "te_beoordelen" | "aandacht";

export function isBeslist(el: AnnotatieElement): boolean {
  return BESLIST_LIFECYCLES.includes(el.lifecycle);
}

/** Hoort dit element bij de gekozen filterstand? */
export function pastInFilter(el: AnnotatieElement, filter: ReviewFilter): boolean {
  if (filter === "te_beoordelen") return !isBeslist(el);
  if (filter === "aandacht") return el.aandacht === "rood" || el.aandacht === "geel";
  return true;
}

const AANDACHT_RANG: Record<string, number> = { rood: 0, geel: 1, groen: 2 };

/** Sorteer de reviewlijst: eerst wat nog beoordeeld moet worden, daarbinnen op aandacht.
 *
 *  Het 🟢🟡🔴-niveau bestaat om de aandacht te sturen, maar in de agent-volgorde staat een rood
 *  oordeel net zo makkelijk onderaan. **Stabiel**: bij een gelijke sleutel blijft de oorspronkelijke
 *  volgorde (= de volgorde in de tekst) staan, zodat kaarten niet onder je handen verspringen.
 */
export function sorteerReview(elementen: AnnotatieElement[]): AnnotatieElement[] {
  return elementen
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const beslistA = isBeslist(a.el) ? 1 : 0;
      const beslistB = isBeslist(b.el) ? 1 : 0;
      if (beslistA !== beslistB) return beslistA - beslistB;
      const rangA = AANDACHT_RANG[a.el.aandacht ?? ""] ?? 3;
      const rangB = AANDACHT_RANG[b.el.aandacht ?? ""] ?? 3;
      if (rangA !== rangB) return rangA - rangB;
      return a.i - b.i;
    })
    .map(({ el }) => el);
}

/** Het volgende (of vorige) element in de getoonde volgorde.
 *
 *  `alleenTeBeoordelen` is het auto-advance-gedrag na een akkoord: doorspringen naar het volgende dat
 *  nog aandacht vraagt in plaats van naar het eerstvolgende in de lijst. Geeft `undefined` als er
 *  niets meer is — dan blijft de selectie staan in plaats van naar het begin te springen.
 */
export function volgendeElement(
  lijst: AnnotatieElement[],
  actiefId: string | undefined,
  richting: 1 | -1 = 1,
  alleenTeBeoordelen = false,
): AnnotatieElement | undefined {
  const kandidaten = alleenTeBeoordelen ? lijst.filter((el) => !isBeslist(el)) : lijst;
  if (kandidaten.length === 0) return undefined;

  const huidig = kandidaten.findIndex((el) => el.id === actiefId);
  if (huidig < 0) {
    // Niets geselecteerd (of het actieve element valt buiten de kandidaten): begin bij de rand.
    return richting === 1 ? kandidaten[0] : kandidaten[kandidaten.length - 1];
  }
  return kandidaten[huidig + richting];
}
