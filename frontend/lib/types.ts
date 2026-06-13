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
  | "fout";

export type Activiteit = "2" | "3";

export type FoutKlasse = "mcp" | "llm" | "validatie" | "intern" | "quota";

// --- Requests ---------------------------------------------------------------

export interface StartRequest {
  bwbId?: string | null;
  wet?: string | null;
  artikel: string;
  lid?: string | null;
  naam?: string;
  omschrijving?: string;
  analysefocus?: string | null;
  review: boolean;
  model_profile?: string | null;
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
  bwbId: string;
  artikel: string;
  updated: string;
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
  bwbId: string;
  artikel: string;
  lid: string | null;
  review: boolean;
  model_profile: string;
  analysefocus: string;
  client_id: string;
  current_activiteit: Activiteit | null;
  current_ronde: number;
  waarschuwingen: string[];
  error: JobFout | null;
  provenance: RondeProvenance[];
  created: string;
  updated: string;
}

// --- Analyse-artefacten (per ronde) -----------------------------------------

export interface Lid {
  lid: string;
  tekst: string;
  bronreferentie: string;
}

export interface Markering {
  id: string;
  formulering: string;
  klasse: string;
  vindplaats: string;
  toelichting: string;
  twijfel: string;
}

export interface Begrip {
  id: string;
  naam: string;
  klasse: string;
  definitie: string;
  voorbeeld: string;
  kenmerken: string;
  vindplaats: string;
  twijfel: string;
}

export interface Afleidingsregel {
  id: string;
  naam: string;
  type: string;
  uitvoervariabele: string;
  invoervariabelen: string;
  parameters: string;
  voorwaarden: string;
  formulering: string;
  vindplaats: string;
  twijfel: string;
}

export interface Analyse2 {
  wet: string;
  bwbId: string;
  artikel: string;
  versiedatum: string;
  bronreferentie: string;
  type: string;
  pad: string;
  analysefocus: string;
  reikwijdte: string;
  geraadpleegde: string;
  leden: Lid[];
  markeringen: Markering[];
  samenhang: string;
}

export interface Analyse3 {
  wet: string;
  bwbId: string;
  artikel: string;
  versiedatum: string;
  bronreferentie: string;
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
  wet: string;
  bwbId: string;
  artikel: string;
  versiedatum: string;
  bronreferentie: string;
  type: string;
  pad: string;
  analysefocus: string;
  reikwijdte: string;
  geraadpleegde: string;
  leden: Lid[];
  markeringen: Markering[];
  samenhang: string;
  begrippen: Begrip[];
  afleidingsregels: Afleidingsregel[];
  validatiepunten: string[];
  reviewlog: Reviewlog;
  aandachtspunten: string;
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
}

// --- API-fout doorgegeven door de BFF ---------------------------------------

export interface ApiError {
  status: number;
  detail: string;
  retryAfter?: number;
}
