// Domeintypes — handmatig afgeleid van het API-contract (api/app/contracts.py).
// Dit bestand is de bron-van-waarheid voor de frontend; zie README (gen:types) voor
// een optioneel hulpmiddel om ze tegen /openapi.json te controleren.

export type JobState =
  | "queued"
  | "act2-runt"
  | "wacht-op-review-act2"
  | "act3-runt"
  | "wacht-op-review-act3"
  | "bouwt"
  | "klaar"
  | "fout"
  // RegelSpraak-vervolgfase (on-demand op een afgeronde analyse)
  | "rs-gegevens-runt"
  | "wacht-op-review-rs-gegevens"
  | "rs-regels-runt"
  | "wacht-op-review-rs-regels"
  | "rs-bouwt"
  | "rs-klaar";

export type Activiteit = "2" | "3" | "rs-gegevens" | "rs-regels";

export type FoutKlasse = "mcp" | "llm" | "validatie" | "intern" | "quota";

// --- Requests ---------------------------------------------------------------

/** Eén bron-keuze (wet+artikel+lid) bij het aanmaken van een werkgebied-analyse. */
export interface BronInput {
  bwbId?: string | null;
  artikel: string;
  lid?: string | null;
}

/** Eén begrip uit een aangeleverde (bestaande) begrippenlijst — suggestieve act-3-invoer. */
export interface BegripInvoer {
  id?: string; // bij ontbreken nummert de API door: ab1..abN
  naam: string;
  synoniemen?: string[];
  definitie?: string;
  klasse?: string;
  bron?: string;
  toelichting?: string;
}

export interface StartRequest {
  bronnen: BronInput[];
  naam?: string;
  omschrijving?: string;
  analysefocus?: string | null; // hoofdvraag
  // Bestaande begrippenlijst (optioneel, suggestief): act 3 hergebruikt waar de betekenis past
  // en registreert per begrip de herkomst (hergebruikt/aangepast/nieuw).
  begrippenlijst?: BegripInvoer[] | null;
  review: boolean;
  model_profile?: string | null;
}

/** Optionele body bij het starten van de RegelSpraak-fase (review=null erft Job.review). */
export interface RegelspraakStart {
  review?: boolean | null;
}

export interface Feedback {
  // "akkoord-afronden" = akkoord op activiteit 2 én daar afronden (geen activiteit 3);
  // alleen geldig op activiteit "2" en zonder opmerkingen.
  status: "akkoord" | "wijzigingen" | "akkoord-afronden";
  activiteit: Activiteit;
  items: Record<string, string>;
  algemeen: string;
}

// Analyse-omvang: "act2" = bewust afgerond zonder activiteit 3 (kan later alsnog).
export type Scope = "volledig" | "act2";

// --- Responses --------------------------------------------------------------

export interface CreateAccepted {
  id: string;
  naam: string;
  state: JobState;
}

export interface FeedbackAccepted {
  id: string;
  state: JobState;
  ronde: number;
}

export interface JobSummary {
  id: string;
  naam: string;
  state: JobState;
  bronnen: BronInput[];
  updated: string;
  // Verrijking voor de eerste (SSR-)render van het dashboard; daarna live via de aggregate-SSE.
  current_fase: string | null;
  model_profile: string;
  scope: Scope;
  tokens_in: number;
  tokens_out: number;
}

export interface JobFout {
  stap: string;
  ronde: number | null;
  klasse: FoutKlasse;
  bericht: string;
}

export interface RondeProvenance {
  activiteit: Activiteit;
  ronde: number;
  model: string;
  provider: string;
  output_strategie: string;
  referentie_hash: string;
  prompt_hash: string;
  mcp_bwbid: string;
  mcp_versiedatum: string;
  mcp_bronreferentie: string;
  tokens_in: number;
  tokens_out: number;
  tijdstip: string;
}

export interface Job {
  id: string;
  state: JobState;
  naam: string;
  omschrijving: string;
  bronnen: BronInput[];
  review: boolean;
  model_profile: string;
  analysefocus: string;
  // Aangeleverde bestaande begrippenlijst (suggestief; zie StartRequest.begrippenlijst).
  begrippenlijst: BegripInvoer[];
  client_id: string;
  regelspraak_review?: boolean | null;
  scope: Scope;
  current_activiteit: Activiteit | null;
  current_ronde: number;
  waarschuwingen: string[];
  error: JobFout | null;
  provenance: RondeProvenance[];
  created: string;
  updated: string;
}

// --- Analyse-artefacten (per ronde) -----------------------------------------

/** Het werkgebied (kennisdomein) — de afbakening waarbinnen de analyse plaatsvindt. */
export interface Werkgebied {
  naam: string;
  hoofdvraag: string;
  omschrijving: string;
  scoping: string;
  analysefocus?: string;
}

/** Absolute, cross-bron vindplaats. */
export interface Vindplaats {
  bron_id: string;
  lid: string;
}

/** Lichte bron-index (bron_id → leesbaar label) die activiteit 3 meedraagt. */
export interface BronRef {
  bron_id: string;
  label: string;
  bwbId: string;
  artikel: string;
  lid: string | null;
}

export interface Lid {
  lid: string;
  tekst: string;
  bronreferentie: string;
}

export interface Markering {
  id: string;
  bron_id: string;
  formulering: string;
  klasse: string;
  vindplaats: string; // lid-relatief binnen de bron
  toelichting: string;
  twijfel: string;
}

/** Gestructureerd kenmerk/relatie van een begrip. */
export interface BegripRelatie {
  soort: string; // relatie | kenmerk
  beschrijving: string;
  doel_begrip?: string | null; // begrip-id bij soort=relatie
}

/** Herkomst t.o.v. een aangeleverde begrippenlijst (suggestief hergebruik). */
export interface BegripHerkomst {
  status: string; // hergebruikt | aangepast | nieuw
  aangeleverd_id: string;
  motivatie: string;
}

export interface Begrip {
  id: string;
  naam: string; // voorkeursterm
  synoniemen: string[];
  klasse: string;
  definitie: string;
  is_interpretatie?: boolean; // true = eigen werkdefinitie i.p.v. letterlijke brondefinitie
  grondformulering: string;
  voorbeeld: string;
  kenmerken: string;
  relaties?: BegripRelatie[];
  vindplaatsen: Vindplaats[];
  markering_ids?: string[]; // act-2-markeringen waarop het begrip berust
  verwijst_naar_begrippen: string[];
  bron_verwijzing?: string;
  herkomst?: BegripHerkomst | null;
  twijfel: string;
}

export interface VerwijzingDoel {
  label: string;
  target: string;
  bwbId: string;
}

export interface Verwijzing {
  id: string;
  bron_id: string;
  bron_lid: string;
  soort: string; // intref | extref | natuurlijk
  functie: string; // definitie | schakel | delegatie | intra-artikel | informatief
  doel: VerwijzingDoel;
  status: string; // opgehaald | gevolgd | gesignaleerd | buiten-scope-diepte
  betekenis: string;
  volgen?: boolean;
}

/** Wat de regel afleidt — een begrip (de begrippen zijn de bouwstenen van regels). */
export interface RegelUitvoer {
  begrip_id: string;
  toelichting: string;
}

export interface RegelInvoer {
  begrip_id: string;
  toelichting: string;
}

export interface RegelParameter {
  begrip_id: string;
  waarde: string; // leeg = staat in een (nog niet geanalyseerde) delegatie
  eenheid: string;
  geldigheid: string;
  vindplaats: Vindplaats;
  toelichting: string;
}

export interface RegelVoorwaarde {
  tekst: string;
  begrip_ids: string[];
  verbinding: string; // EN | OF | "" (koppeling met de vórige voorwaarde)
}

export interface Afleidingsregel {
  id: string;
  naam: string;
  type: string;
  uitvoer: RegelUitvoer;
  invoer: RegelInvoer[];
  parameters: RegelParameter[];
  voorwaarden: RegelVoorwaarde[];
  toelichting: string;
  vindplaatsen: Vindplaats[];
  markering_ids?: string[]; // Afleidingsregel-markering(en) uit act 2
  twijfel: string;
}

/** Eén bron in het werkgebied: een (bwbId, artikel, lid?)-eenheid met haar act-2-uitkomst. */
export interface Bron {
  bron_id: string;
  label: string;
  wet: string;
  bwbId: string;
  artikel: string;
  lid: string | null;
  versiedatum: string;
  bronreferentie: string;
  type: string;
  pad: string;
  reikwijdte: string;
  geraadpleegde: string;
  leden: Lid[];
  markeringen: Markering[];
  verwijzingen: Verwijzing[];
  samenhang: string;
}

export interface Analyse2 {
  werkgebied: Werkgebied;
  analysefocus: string;
  bronnen: Bron[];
}

export interface Analyse3 {
  werkgebied: Werkgebied;
  bronnen: BronRef[];
  begrippen: Begrip[];
  afleidingsregels: Afleidingsregel[];
  validatiepunten: string[];
}

// --- Rapport ----------------------------------------------------------------

export interface ReviewRonde {
  ronde: number;
  items: Record<string, string>;
  algemeen: string;
  // Feedback-status van de ronde ("akkoord" | "wijzigingen" | "akkoord-afronden");
  // ontbreekt bij een ronde zonder feedback.
  status?: string;
}

export interface ReviewActiviteit {
  samenvatting: string;
  rondes: ReviewRonde[];
}

export interface Reviewlog {
  activiteit2?: ReviewActiviteit;
  activiteit3?: ReviewActiviteit;
}

export interface Rapport {
  werkgebied: Werkgebied;
  bronnen: Bron[];
  begrippen: Begrip[];
  afleidingsregels: Afleidingsregel[];
  validatiepunten: string[];
  reviewlog: Reviewlog;
  aandachtspunten: string;
}

// --- RegelSpraak-model (GegevensSpraak + regels) ----------------------------

/** Herkomst van een declaratie/regel terug naar de wetsanalyse (begrip/regel + vindplaats). */
export interface RegelspraakHerkomst {
  begrip_ids?: string[];
  regel_id?: string;
  bron_id?: string;
  vindplaatsen?: Vindplaats[];
}

export interface RsAttribuut {
  naam: string;
  lidwoord?: string;
  datatype: string;
  eenheid?: string;
}

export interface RsKenmerk {
  naam: string;
  soort?: string; // bijvoeglijk | bezittelijk | overig
}

export interface RsObjecttype {
  id: string;
  naam: string;
  lidwoord?: string;
  meervoud?: string;
  bezield?: boolean;
  attributen?: RsAttribuut[];
  kenmerken?: RsKenmerk[];
  regelspraak_tekst?: string;
  herkomst?: RegelspraakHerkomst;
  twijfel?: string;
}

export interface RsRol {
  naam: string;
  lidwoord?: string;
  objecttype?: string;
  multipliciteit?: string; // een | meerdere
}

export interface RsFeittype {
  id: string;
  naam: string;
  wederkerig?: boolean;
  rollen?: RsRol[];
  relatiebeschrijving?: string;
  regelspraak_tekst?: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsParameter {
  id: string;
  naam: string;
  lidwoord?: string;
  datatype: string;
  eenheid?: string;
  regelspraak_tekst?: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsDomein {
  naam: string;
  regelspraak_tekst?: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsEenheidssysteem {
  naam: string;
  regelspraak_tekst?: string;
}

export interface GegevensSpraak {
  eenheidssystemen?: RsEenheidssysteem[];
  domeinen?: RsDomein[];
  objecttypen?: RsObjecttype[];
  feittypen?: RsFeittype[];
  parameters?: RsParameter[];
  dimensies?: unknown[];
  tijdlijnen?: unknown[];
  dagsoorten?: unknown[];
}

export interface RsRegel {
  id: string;
  // naam/soort/regelspraak_tekst komen van het LLM en zijn API-zijdig niet hard gevalideerd
  // (regels is een ongetypeerde list); spiegel dat zwakke contract met optionele velden.
  naam?: string;
  soort?: string;
  regelspraak_tekst?: string;
  herkomst?: RegelspraakHerkomst;
  twijfel?: string;
}

export interface RegelspraakModel {
  werkgebied: Werkgebied;
  gegevensspraak: GegevensSpraak;
  regels: RsRegel[];
  reviewlog_gegevensspraak: string;
  reviewlog_regels: string;
  validatiepunten: string[];
  reviewlog?: unknown;
}

// --- Catalogus (niet-admin): keuzelijsten -----------------------------------

export interface ProfileChoice {
  name: string;
  is_default: boolean;
}

export interface WetChoice {
  bwbId: string;
  naam: string;
}

// Wetsstructuur + artikelinfo voor het analyseformulier (artikel-autocomplete, lid-keuze).
// Gespiegeld van WetStructuurOut/ArtikelInfoOut in api/app/routers/catalog.py.
export interface ArtikelChoice {
  artikel: string;
  pad: string;
}

export interface WetStructuur {
  bwbId: string;
  citeertitel: string;
  versiedatum: string;
  artikelen: ArtikelChoice[];
}

export interface ArtikelInfo {
  bwbId: string;
  artikel: string;
  citeertitel: string;
  opschrift: string;
  pad: string;
  leden: string[];
  snippet: string;
}

// --- Admin: wet-catalogus ---------------------------------------------------

export interface WetIn {
  naam: string;
}

export interface WetOut {
  bwbId: string;
  naam: string;
  updated_by: string;
  updated: string;
}

export interface WetResolveResult {
  naam: string;
}

// --- Admin: LLM-modelprofielen + verbruik -----------------------------------

export interface LlmProfileIn {
  provider?: string;
  model?: string;
  api_base?: string;
  api_version?: string | null;
  output_strategy?: string;
  temperature?: number;
  /** Write-only: leeg laten = bestaande key ongewijzigd. */
  api_key?: string;
  is_default?: boolean;
}

export interface UsageRow {
  sleutel: string;
  tokens_in: number;
  tokens_out: number;
  rondes: number;
  analyses: number;
}

export interface LlmProfileOut {
  name: string;
  provider: string;
  model: string;
  api_base: string;
  api_version: string | null;
  output_strategy: string;
  temperature: number;
  is_default: boolean;
  api_key_set: boolean;
  updated_by: string;
  updated: string;
  verbruik: UsageRow | null;
}

export interface TestResult {
  ok: boolean;
  model: string;
  tokens_in: number;
  tokens_out: number;
  detail: string;
}

export interface UsageReport {
  group_by: string;
  rows: UsageRow[];
  totaal: { tokens_in: number; tokens_out: number; rondes: number; analyses: number };
}

// --- SSE --------------------------------------------------------------------

export interface SSEUpdate {
  state: JobState;
  current_activiteit: Activiteit | null;
  current_ronde: number;
  current_fase: string | null;
}

/**
 * Eén project-momentopname uit de geaggregeerde dashboard-SSE (`/api/projects/events`).
 * Spiegelt `_dashboard_payload` in api/app/routers/projects.py.
 */
export interface DashboardUpdate {
  id: string;
  naam: string;
  bronnen: BronInput[];
  state: JobState;
  scope: Scope;
  current_activiteit: Activiteit | null;
  current_ronde: number;
  current_fase: string | null;
  current_fase_sinds: string | null;
  created: string;
  updated: string;
  model_profile: string;
  tokens_in: number;
  tokens_out: number;
  error: { stap: string; klasse: FoutKlasse; bericht: string } | null;
}

// --- Auth: accounts + rollen ------------------------------------------------

export type Role = "beheerder" | "analist";

export interface UserOut {
  userid: string;
  email: string;
  role: Role;
  totp_enabled: boolean;
  active: boolean;
  created: string;
  updated: string;
}

/** Antwoord bij aanmaken/resetten: het tijdelijke wachtwoord wordt eenmalig getoond. */
export interface UserCreated extends UserOut {
  temp_password: string;
}

export interface TempPassword {
  userid: string;
  temp_password: string;
}

/** Eigen account (self-service); spiegelt /v1/auth/me. */
export interface MeAccount {
  userid: string;
  email: string;
  role: Role;
  totp_enabled: boolean;
}

export interface TotpBegin {
  otpauth_uri: string;
}

/** Uitkomst van de login-pre-check (/api/login-verify). code: "" | "ok" | "invalid" | "totp_required" | "rate". */
export interface LoginVerifyResult {
  ok: boolean;
  code: string;
  userid: string;
  email: string;
  role: Role | "";
}

// --- runtime-instellingen + LLM-call-capture --------------------------------

export interface AppSettings {
  capture_llm_calls: boolean;
}

export interface LlmCall {
  id: number;
  project_slug: string;
  activiteit: string;
  ronde: number;
  poging: number;
  fase: string;
  model: string;
  provider: string;
  system_prompt: string;
  user_prompt: string;
  response_text: string;
  tokens_in: number;
  tokens_out: number;
  ok: boolean;
  error: string | null;
  tijdstip: string;
}

// --- API-fout doorgegeven door de BFF ---------------------------------------

export interface ApiError {
  status: number;
  detail: string;
  retryAfter?: number;
}
