import { jasVolgorde } from "./jas";
import type {
  AgentContext,
  AgentKandidaat,
  AnnotatieDocument,
  AnnotatieElement,
  GraafArtikel,
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

/** Lidnummer als getal, voor sorteren. Lexicaal zou "10" vóór "2" zetten; een leeg lid komt eerst. */
function lidRang(lid: string): number {
  const n = Number.parseInt(lid, 10);
  return Number.isNaN(n) ? -1 : n;
}

/** Sorteer de reviewlijst in één vaste, inhoudelijke volgorde: de canonieke JAS-tabel.
 *
 *  Eerder woog aandacht (🔴🟡🟢) en voortgang het zwaarst. Beide veranderen terwijl je reviewt: keur
 *  je iets goed, dan sprong het naar achteren en schoof de rest op — je raakte je plek kwijt en een
 *  kaart stond nooit twee keer op dezelfde hoogte. Scherpstellen op twijfelgevallen doen de filters.
 *
 *  Sleutels van grof naar fijn: klasse (wa-tabelvolgorde) → lid → positie in de tekst →
 *  invoervolgorde. Geen van die vier verandert door reviewen; alleen als jíj de klasse wijzigt
 *  verhuist een element, en dan hóórt het ergens anders.
 *
 *  `posities` is de offset per element-id in de brontekst (het artefact berekent die met dezelfde
 *  `vindPositie` als de weergave). Ontbreekt hij, dan sorteert deze functie een niveau grover in
 *  plaats van te struikelen; een element dat niet in de tekst te vinden is komt achteraan binnen
 *  zijn eigen klasse.
 */
export function sorteerReview(
  elementen: AnnotatieElement[],
  posities?: Map<string, number>,
): AnnotatieElement[] {
  const positie = (el: AnnotatieElement) => posities?.get(el.id) ?? Number.POSITIVE_INFINITY;
  return elementen
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const klasse = jasVolgorde(a.el.klasse) - jasVolgorde(b.el.klasse);
      if (klasse !== 0) return klasse;
      const lid = lidRang(a.el.lid) - lidRang(b.el.lid);
      if (lid !== 0) return lid;
      // Let op: niet `pa - pb` — met twee keer Infinity levert dat NaN, en met één Infinity een
      // waarde die de "niet gevonden"-kaart niet betrouwbaar achteraan zet.
      const pa = positie(a.el);
      const pb = positie(b.el);
      if (pa !== pb) return pa === Number.POSITIVE_INFINITY ? 1 : pb === Number.POSITIVE_INFINITY ? -1 : pa - pb;
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

// --- een vraag over één markering ------------------------------------------------------------------

/** Hoeveel andere markeringen er hoogstens meegaan. Een bepaling kan er tientallen hebben; dan is de
 *  lijst geen hulp meer maar promptvulling. */
const MAX_BUREN = 20;

/** Bouw het contextblok voor een adviesvraag bij een element.
 *
 *  De agent kan niet in het document kijken; deze context vertelt hem waar de vraag over gaat. `lid`
 *  valt terug op het document als het element zelf er geen heeft (bij een artikel zonder leden), en
 *  het corpus is de getoonde artikeltekst — dezelfde die de jurist voor zich ziet.
 */
export function vraagContextVan(
  slug: string,
  doc: AnnotatieDocument | undefined,
  info: GraafArtikel | undefined,
  el: AnnotatieElement,
): AgentContext {
  return {
    slug,
    bwbId: doc?.bwbId,
    artikel: doc?.artikel,
    lid: el.lid || doc?.lid,
    element_id: el.id,
    klasse: el.klasse,
    fragment: el.tekst,
    corpus: info?.leden_teksten.map((l) => l.tekst).join("\n\n"),
    // De overige markeringen gaan mee, zodat de agent er bij de onderbouwing naar kan verwijzen
    // (samenhang, afbakening) zonder ervoor terug te vallen op het gespreksgeheugen. Zou hij dat wel
    // doen, dan verschilt het antwoord op dezelfde vraag per gesprek. Verworpen elementen blijven
    // eruit — die zijn juist afgekeurd — en het gevraagde element ook: dat staat al als `fragment`.
    bestaande_elementen: (doc?.elementen ?? [])
      .filter((e) => e.id !== el.id && e.lifecycle !== "rejected")
      .slice(0, MAX_BUREN)
      .map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst, lid: e.lid, herkomst: e.herkomst })),
  };
}


/** Korte aanduiding van waar een vraag over gaat, voor de chip én voor het bewaarde bericht.
 *
 *  Zonder deze regel leest een herladen gesprek als een losse vraag zonder onderwerp: de chip is
 *  UI-state en gaat niet mee naar de api.
 */
export function vraagContextLabel(el: AnnotatieElement, doc?: AnnotatieDocument): string {
  const plek = doc ? ` (art. ${doc.artikel}${el.lid ? ` lid ${el.lid}` : ""})` : "";
  return `${el.klasse} — “${el.tekst}”${plek}`;
}
