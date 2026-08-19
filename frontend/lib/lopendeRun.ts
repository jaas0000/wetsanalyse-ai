// Welke beurt had dit gesprek nog lopen toen je wegging?
//
// Een run leeft in het geheugen van graph-qa. Een deploy of herstart wist dat register — en dan is
// een client die terugkomt met een run-id dat niemand meer kent nergens meer aan te haken. Zonder
// dit spoor zie je dan niets: geen antwoord, geen melding, alleen een gesprek dat halverwege
// ophoudt. Mét dit spoor kan de werkplek zeggen wát er gebeurd is.
//
// Bewust `localStorage` en niet `sessionStorage`: een herlaadbeurt in een nieuw tabblad moet het
// óók weten. En bewust alleen het id — de inhoud van een beurt hoort in de api, niet in de browser.
//
// De logica staat hier als pure functies omdat vitest node-env draait zonder DOM (zie
// `lib/selectie.ts`); het component doet alleen de opslag-aanroepen.

const SLEUTEL = "wa_lopende_run";

/** Wat er in de opslag staat: per gesprek het id van de beurt die liep. */
export type LopendeRuns = Record<string, string>;

export function onthoudRun(huidig: LopendeRuns, gesprekId: string, runId: string): LopendeRuns {
  return { ...huidig, [gesprekId]: runId };
}

export function vergeetRun(huidig: LopendeRuns, gesprekId: string): LopendeRuns {
  const { [gesprekId]: _weg, ...rest } = huidig;
  return rest;
}

/** Wat is er met de vorige beurt van dit gesprek gebeurd?
 *
 *  - `"geen"` — er stond niets open.
 *  - `"afgerond"` — de beurt is netjes vastgelegd; het bericht staat in de geschiedenis. Alleen het
 *    spoor opruimen, geen mededeling: de gebruiker ziet het antwoord gewoon staan.
 *  - `"verdwenen"` — er is geen run meer én geen bericht. Dan is het register weg (herstart) en
 *    hoort dat gezegd te worden, in plaats van een beurt die stilzwijgend nooit afkwam.
 *
 *  De controle op het bericht is wat dit betrouwbaar maakt: een run die afliep terwijl niemand keek
 *  is óók uit het register verdwenen (na de bewaartermijn), maar heeft wél een bericht achtergelaten.
 *  Zonder dat onderscheid zou elke normale afloop als "afgebroken" gemeld worden.
 */
export function standVanVorigeRun(
  bewaardRunId: string | undefined,
  berichtRunIds: readonly string[],
): "geen" | "afgerond" | "verdwenen" {
  if (!bewaardRunId) return "geen";
  return berichtRunIds.includes(bewaardRunId) ? "afgerond" : "verdwenen";
}

/** Wat doe je als de eventstroom van een lopende beurt met een fout eindigt?
 *
 *  - `"negeren"` — wíj koppelden zelf los (unmount, van gesprek wisselen). De run draait door.
 *  - `"opnieuw"` — de verbinding viel weg. Ook dan draait de run door: hij leeft bij de agent, niet
 *    in dit tabblad. Opnieuw aanhaken vanaf `seq 0` speelt de eventlog terug, dus je mist niets.
 *  - `"melden"` — er is geen herkansing meer over, of het venster is weg. Nu pas een foutmelding.
 *
 *  Waarom dit een eigen regel is: de werkplek toonde bij elke andere fout dan een `AbortError`
 *  meteen "Er ging iets mis". Bij een deploy — de frontend-container wordt vervangen — betekende dat
 *  een beurt die als mislukt in beeld kwam terwijl hij op dat moment gewoon doorliep en even later
 *  slaagde, mét een opgeslagen bericht bij de api. De client hoorde daar niet over te oordelen.
 */
export function naEenGebrokenStream(
  zelfAfgebroken: boolean,
  pogingenGedaan: number,
  maxPogingen: number,
  vensterLeeft: boolean,
): "negeren" | "opnieuw" | "melden" {
  if (zelfAfgebroken) return "negeren";
  return pogingenGedaan < maxPogingen && vensterLeeft ? "opnieuw" : "melden";
}

// --- browser-opslag (dun laagje om de pure functies heen) -----------------------------------

export function leesLopendeRuns(): LopendeRuns {
  try {
    const rauw = window.localStorage.getItem(SLEUTEL);
    return rauw ? (JSON.parse(rauw) as LopendeRuns) : {};
  } catch {
    // Privémodus, volle opslag of rommel in de sleutel: dit is een hulpmiddel, geen contract.
    return {};
  }
}

export function schrijfLopendeRuns(runs: LopendeRuns): void {
  try {
    window.localStorage.setItem(SLEUTEL, JSON.stringify(runs));
  } catch {
    /* opslag niet beschikbaar — dan missen we hoogstens de melding */
  }
}
