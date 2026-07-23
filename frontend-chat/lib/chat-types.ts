// Chat-app types — volledig geïsoleerd van de wetsanalyse-frontend.

export type Role = "beheerder" | "analist";
export type PanelView = "chat" | "settings" | "account";

// --- Annotatie ---
export interface AnnotatieAlternatief {
  klasse: string;
  motivatie: string;
}

export interface AnnotatieElement {
  klasse: string;
  tekst: string;
  lid: string;
  toelichting: string;
  alternatieven: AnnotatieAlternatief[];
  span: [number, number] | null;
  grounded: boolean;
  vindplaats: string;
  aandacht: "" | "groen" | "geel" | "rood";
  critic: string;
  // feedback van de gebruiker
  feedback?: "akkoord" | "afwijzen" | "twijfel";
  feedbackNotitie?: string;
}

export interface OntbrekendItem {
  klasse: string;
  reden: string;
}

export interface LidTekst {
  lid: string;
  tekst: string;
}

export interface AnnotatieDoel {
  bwbId: string;
  artikel: string;
  lid?: string;
  citeertitel?: string;
  leden_teksten: LidTekst[];
}

// --- Gesprek & berichten ----------------------------------------------------

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;    // Unix ms
  updatedAt: number;
  messages: Message[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;          // eindtekst of user-input
  reasoning?: string;       // denkproces (agent)
  sources?: Source[];
  groundingOk?: boolean | null;
  isStreaming?: boolean;
  createdAt: number;
}

// --- Bronnen ----------------------------------------------------------------

export interface Source {
  // graph-qa formaat
  label?: string;
  uri?: string;
  iri?: string | null;
  jci?: string | null;
  origin_tool?: string;
  // optionele weergave-velden
  wet?: string;
  artikel?: string;
  tekst?: string;
  bwbId?: string;
}

// --- SSE events van graph-qa ------------------------------------------------

export type SSEEventType =
  | "status"
  | "reason"
  | "token"
  | "sources"
  | "grounding"
  | "done"
  | "error"
  | "ping";

export interface SSEEvent {
  type: SSEEventType;
  data: SSEData;
}

export type SSEData =
  | { type: "status"; message: string }
  | { type: "reason"; content: string }
  | { type: "token"; content: string }
  | { type: "sources"; sources: Source[]; grounding_ok?: boolean }
  | { type: "grounding"; grounded: boolean }
  | { type: "done" }
  | { type: "error"; message: string }
  | Record<string, unknown>;                  // ping / overige

// --- Account ----------------------------------------------------------------

export interface MeAccount {
  userid: string;
  email: string;
  role: Role;
  name?: string;
  totp_enabled?: boolean;
}
