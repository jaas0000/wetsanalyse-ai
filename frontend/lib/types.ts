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

export interface StartRequest {
  bronnen: BronInput[];
  naam?: string;
  omschrijving?: string;
  analysefocus?: string | null; // hoofdvraag
  review: boolean;
  model_profile?: string | null;
}

/** Optionele body bij het starten van de RegelSpraak-fase (review=null erft Job.review). */
export interface RegelspraakStart {
  review?: boolean | null;
}

export interface Feedback {
  status: "akkoord" | "wijzigingen";
  activiteit: Activiteit;
  items: Record<string, string>;
  algemeen: string;
}

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
  bronnen: BronInput[];
  review: boolean;
  model_profile: string;
  analysefocus: string;
  client_id: string;
  regelspraak_review?: boolean | null;
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

export interface Begrip {
  id: string;
  naam: string; // voorkeursterm
  synoniemen: string[];
  klasse: string;
  definitie: string;
  grondformulering: string;
  voorbeeld: string;
  kenmerken: string;
  vindplaatsen: Vindplaats[];
  verwijst_naar_begrippen: string[];
  bron_verwijzing?: string;
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

export interface Afleidingsregel {
  id: string;
  naam: string;
  type: string;
  uitvoervariabele: string;
  invoervariabelen: string;
  parameters: string;
  voorwaarden: string;
  vindplaatsen: Vindplaats[];
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
  regelspraak_tekst: string;
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
  regelspraak_tekst: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsParameter {
  id: string;
  naam: string;
  lidwoord?: string;
  datatype: string;
  eenheid?: string;
  regelspraak_tekst: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsDomein {
  naam: string;
  regelspraak_tekst: string;
  herkomst?: RegelspraakHerkomst;
}

export interface RsEenheidssysteem {
  naam: string;
  regelspraak_tekst: string;
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
  naam: string;
  soort: string;
  regelspraak_tekst: string;
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

// --- API-fout doorgegeven door de BFF ---------------------------------------

export interface ApiError {
  status: number;
  detail: string;
  retryAfter?: number;
}
