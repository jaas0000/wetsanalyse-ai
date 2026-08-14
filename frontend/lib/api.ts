// Client-side fetch-helpers. Praten UITSLUITEND met de eigen Next.js-origin (/api/**);
// de BFF-laag injecteert het token server-side. Hier dus geen Authorization-header.

import type {
  ApiError,
  ApiTokenCreated,
  ApiTokenOut,
  LlmProfileIn,
  LlmProfileOut,
  LoginVerifyResult,
  MeAccount,
  Role,
  TempPassword,
  TestResult,
  TotpBegin,
  UserCreated,
  UserOut,
} from "./types";
import type {
  AdminBerichtenPaginaOut,
  AdminBerichtOut,
  AgentDoel,
  Anker,
  AnnotatieDocument,
  AuditRecord,
  Bericht,
  BerichtAanmakenIn,
  BerichtenPaginaOut,
  BerichtInvoer,
  BerichtOut,
  BerichtPublicatieIn,
  BeslissingInvoer,
  Bron,
  DocumentCreate,
  DocumentSamenvatting,
  Gesprek,
  GesprekSamenvatting,
  GraafArtikel,
  OngelezenAantalOut,
  OntbrekendItem,
  VoorstelElement,
} from "./types";
import { pathSegment } from "./url";

export async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    /* geen JSON-body */
  }
  const ra = res.headers.get("Retry-After");
  return { status: res.status, detail, retryAfter: ra ? Number(ra) : undefined };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

function veiligJson(s: string): { answer?: string; detail?: string } | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "status" in e && "detail" in e;
}

// --- Admin: LLM-modelprofielen ----------------------------------------------

export async function listProfiles(): Promise<LlmProfileOut[]> {
  const res = await fetch("/api/admin/profiles", { cache: "no-store" });
  return json<LlmProfileOut[]>(res);
}

export async function saveProfile(name: string, body: LlmProfileIn): Promise<LlmProfileOut> {
  const res = await fetch(`/api/admin/profiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<LlmProfileOut>(res);
}

export async function deleteProfile(name: string): Promise<void> {
  const res = await fetch(`/api/admin/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

export async function setDefaultProfile(name: string): Promise<LlmProfileOut> {
  const res = await fetch(`/api/admin/profiles/${encodeURIComponent(name)}/default`, { method: "POST" });
  return json<LlmProfileOut>(res);
}

export async function testProfile(name: string): Promise<TestResult> {
  const res = await fetch(`/api/admin/profiles/${encodeURIComponent(name)}/test`, { method: "POST" });
  return json<TestResult>(res);
}

// --- Admin: gebruikers ------------------------------------------------------

export async function listUsers(): Promise<UserOut[]> {
  const res = await fetch("/api/admin/users", { cache: "no-store" });
  return json<UserOut[]>(res);
}

export async function createUser(userid: string, email: string, role: Role): Promise<UserCreated> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid, email, role }),
  });
  return json<UserCreated>(res);
}

export async function patchUser(userid: string, body: { role?: Role; active?: boolean }): Promise<UserOut> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<UserOut>(res);
}

export async function resetUserPassword(userid: string): Promise<TempPassword> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}/reset-password`, { method: "POST" });
  return json<TempPassword>(res);
}

export async function deleteUser(userid: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userid)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

// --- Admin: genereerbare API-tokens -----------------------------------------

export async function listApiTokens(): Promise<ApiTokenOut[]> {
  const res = await fetch("/api/admin/api-tokens", { cache: "no-store" });
  return json<ApiTokenOut[]>(res);
}

export async function createApiToken(label: string): Promise<ApiTokenCreated> {
  const res = await fetch("/api/admin/api-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return json<ApiTokenCreated>(res);
}

export async function revokeApiToken(id: string): Promise<void> {
  const res = await fetch(`/api/admin/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

// --- Login (pre-check vóór de Auth.js-sessie) -------------------------------

/** Stap A — pre-check: kloppen userid+wachtwoord, en is 2FA vereist? Een vertrouwd apparaat (cookie)
 *  levert direct code "ok". Zet zelf geen sessie. */
export async function loginVerify(
  userid: string,
  password: string,
): Promise<LoginVerifyResult> {
  const res = await fetch("/api/login-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid, password }),
  });
  if (!res.ok && res.status !== 200) {
    return { ok: false, code: res.status === 429 ? "rate" : "invalid", userid: "", email: "", role: "" };
  }
  return (await res.json()) as LoginVerifyResult;
}

/** Stap B — verifieer de 2FA-code op het aparte /login/2fa-scherm via het login-ticket (httpOnly
 *  cookie). `remember` zet de trusted-device-cookie (30 dagen). Zet zelf geen sessie. */
export async function login2fa(
  userid: string,
  totp: string,
  remember: boolean,
): Promise<LoginVerifyResult> {
  const res = await fetch("/api/login-2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid, totp, remember }),
  });
  if (!res.ok && res.status !== 200) {
    return { ok: false, code: res.status === 429 ? "rate" : "invalid", userid: "", email: "", role: "" };
  }
  return (await res.json()) as LoginVerifyResult;
}

// --- PoC-disclaimer ----------------------------------------------------------

export async function accepteerDisclaimer(): Promise<void> {
  const res = await fetch("/api/disclaimer", { method: "POST" });
  if (!res.ok) throw await parseError(res);
}

/** Bij het uitloggen: de sessiecookie overleeft anders een logout in dezelfde browsersessie. */
export async function wisDisclaimer(): Promise<void> {
  await fetch("/api/disclaimer", { method: "DELETE" }).catch(() => {
    /* uitloggen mag hier nooit op stuklopen */
  });
}

// --- Account (self-service): 2FA --------------------------------------------

export async function getAccount(): Promise<MeAccount> {
  const res = await fetch("/api/account/me", { cache: "no-store" });
  return json<MeAccount>(res);
}

export async function begin2fa(): Promise<TotpBegin> {
  const res = await fetch("/api/account/2fa/begin", { method: "POST" });
  return json<TotpBegin>(res);
}

export async function activate2fa(totp: string): Promise<void> {
  const res = await fetch("/api/account/2fa/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totp }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function disable2fa(totp: string): Promise<void> {
  const res = await fetch("/api/account/2fa/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totp }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function changePassword(current: string, nieuw: string): Promise<void> {
  const res = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current, new: nieuw }),
  });
  if (!res.ok) throw await parseError(res);
}

// --- Annotatie-workbench -----------------------------------------------------

export async function maakDocument(req: DocumentCreate): Promise<AnnotatieDocument> {
  const res = await fetch("/api/annotatie/documenten", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return json<AnnotatieDocument>(res);
}

export async function lijstDocumenten(): Promise<DocumentSamenvatting[]> {
  return json<DocumentSamenvatting[]>(await fetch("/api/annotatie/documenten", { cache: "no-store" }));
}

export async function haalDocument(slug: string): Promise<AnnotatieDocument> {
  return json<AnnotatieDocument>(
    await fetch(`/api/annotatie/documenten/${pathSegment(slug)}`, { cache: "no-store" }),
  );
}

export async function verwijderDocument(slug: string): Promise<void> {
  const res = await fetch(`/api/annotatie/documenten/${pathSegment(slug)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

export async function zetElementen(
  slug: string,
  elementen: VoorstelElement[],
  ronde = 0,
  suggesties: { element_id: string; aandacht: string; motivatie: string }[] = [],
): Promise<AnnotatieDocument> {
  // De server MERGET dit met wat er al staat (op id, anders op tekst); `ronde` komt in de audit
  // zodat achteraf te zien is welke agent-ronde welk element opleverde.
  const res = await fetch(`/api/annotatie/documenten/${pathSegment(slug)}/elementen`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elementen, ronde, suggesties }),
  });
  return json<AnnotatieDocument>(res);
}

/** Voeg een EIGEN markering toe (tekstselectie van de jurist). Aparte route van `zetElementen`:
 *  dat is de uitkomst van een agent-ronde, dit komt er los bij en raakt de rest niet. */
export async function voegElementToe(
  slug: string,
  element: { klasse: string; tekst: string; lid?: string; toelichting?: string; vindplaats?: string; anker?: Anker },
): Promise<AnnotatieDocument> {
  const res = await fetch(`/api/annotatie/documenten/${pathSegment(slug)}/elementen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(element),
  });
  return json<AnnotatieDocument>(res);
}

/** Verwijder een eigen markering. Agent-voorstellen verwerp je (`beslis` met `reject`); die
 *  verdwijnen niet, zodat het auditspoor laat zien dát er een voorstel was. */
export async function verwijderElement(slug: string, elementId: string): Promise<void> {
  const res = await fetch(
    `/api/annotatie/documenten/${pathSegment(slug)}/elementen/${pathSegment(elementId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await parseError(res);
}

export async function beslis(
  slug: string,
  elementId: string,
  req: BeslissingInvoer,
): Promise<AnnotatieDocument> {
  const res = await fetch(
    `/api/annotatie/documenten/${pathSegment(slug)}/elementen/${pathSegment(elementId)}/beslissing`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
  );
  return json<AnnotatieDocument>(res);
}

export async function haalAudit(slug: string): Promise<AuditRecord[]> {
  return json<AuditRecord[]>(
    await fetch(`/api/annotatie/documenten/${pathSegment(slug)}/audit`, { cache: "no-store" }),
  );
}

// --- Gesprekken (chatgeschiedenis; per-gebruiker via de BFF-X-User-Id) ------

export async function lijstGesprekken(): Promise<GesprekSamenvatting[]> {
  return json<GesprekSamenvatting[]>(await fetch("/api/gesprekken", { cache: "no-store" }));
}

export async function maakGesprek(titel = ""): Promise<Gesprek> {
  const res = await fetch("/api/gesprekken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titel }),
  });
  return json<Gesprek>(res);
}

export async function haalGesprek(id: string): Promise<Gesprek> {
  return json<Gesprek>(await fetch(`/api/gesprekken/${pathSegment(id)}`, { cache: "no-store" }));
}

export async function voegBerichtToe(id: string, bericht: BerichtInvoer): Promise<Bericht> {
  const res = await fetch(`/api/gesprekken/${pathSegment(id)}/berichten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bericht),
  });
  return json<Bericht>(res);
}

export async function hernoemGesprek(id: string, titel: string): Promise<Gesprek> {
  const res = await fetch(`/api/gesprekken/${pathSegment(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titel }),
  });
  return json<Gesprek>(res);
}

export async function verwijderGesprek(id: string): Promise<void> {
  const res = await fetch(`/api/gesprekken/${pathSegment(id)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

/** Stuur een vrije prompt naar de unified agent (BFF → graph-qa /v1/chat, SSE). De supervisor kiest
 *  per beurt `antwoord` (streamt tekst-`token`s + `sources`) of `annotatie` (`doel` + `element`).
 *  `conversationId` houdt het gespreksgeheugen vast (thread_id). */
/** Context bij een adviesvraag of een annotatie: waar gaat het over. */
export interface AgentContext {
  slug?: string;
  bwbId?: string;
  artikel?: string;
  lid?: string;
  element_id?: string;
  klasse?: string;
  fragment?: string;
  corpus?: string;
  bestaande_elementen?: { id: string; klasse: string; tekst: string; lid: string; herkomst: string }[];
}

export async function annoteerAgentStream(
  prompt: string,
  handlers: {
    onStatus?: (m: string) => void;
    onReason?: (t: string) => void;
    onToken?: (t: string) => void;
    onSources?: (bronnen: Bron[]) => void;
    onDoel?: (doel: AgentDoel) => void;
    onElement?: (el: VoorstelElement) => void;
    onOntbrekend?: (items: OntbrekendItem[]) => void;
    /** Kanttekening van de Critic bij een markering die de JURIST maakte. Nooit een wijziging. */
    onSuggestie?: (s: { element_id: string; aandacht: string; motivatie: string }) => void;
  },
  conversationId?: string,
  signal?: AbortSignal,
  extra?: { modus?: "auto" | "advies"; context?: AgentContext },
): Promise<void> {
  const res = await fetch("/api/annotatie/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: prompt,
      conversation_id: conversationId,
      ...(extra?.modus ? { modus: extra.modus } : {}),
      ...(extra?.context ? { context: extra.context } : {}),
    }),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw { status: 0, detail: "Geen agentstroom." } as ApiError;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // sse-starlette scheidt met \r\n; strip de CR zodat indexOf("\n\n") de frame-grens vindt.
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let scheiding: number;
      while ((scheiding = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, scheiding);
        buffer = buffer.slice(scheiding + 2);
        let data = "";
        for (const regel of frame.split("\n")) {
          if (regel.startsWith(":")) continue; // heartbeat
          if (regel.startsWith("data:")) data += regel.slice(5).trim();
        }
        if (!data) continue;
        const ev = veiligJson(data) as
          | {
              type: string;
              message?: string;
              content?: string;
              doel?: AgentDoel;
              element?: VoorstelElement;
              items?: OntbrekendItem[];
              sources?: Bron[];
              suggestie?: { element_id: string; aandacht: string; motivatie: string };
            }
          | null;
        if (!ev) continue;
        if (ev.type === "status") handlers.onStatus?.(ev.message ?? "");
        else if (ev.type === "reason") handlers.onReason?.(ev.content ?? "");
        else if (ev.type === "token") handlers.onToken?.(ev.content ?? "");
        else if (ev.type === "sources" && ev.sources) handlers.onSources?.(ev.sources);
        else if (ev.type === "doel" && ev.doel) handlers.onDoel?.(ev.doel);
        else if (ev.type === "element" && ev.element) handlers.onElement?.(ev.element);
        else if (ev.type === "ontbrekend") handlers.onOntbrekend?.(ev.items ?? []);
        else if (ev.type === "suggestie" && ev.suggestie) handlers.onSuggestie?.(ev.suggestie);
        else if (ev.type === "error") throw { status: 502, detail: ev.message ?? "Agent mislukt." } as ApiError;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Artikeltekst uit de graaf (voedt het workbench-documentpaneel; één bron met de annotatie-corpus).
 *  Met `lid` beperk je de tekst tot dat ene lid. */
export async function haalArtikelGraaf(bwbId: string, artikel: string, lid?: string): Promise<GraafArtikel> {
  const q = `bwb_id=${encodeURIComponent(bwbId)}&artikel=${encodeURIComponent(artikel)}${
    lid ? `&lid=${encodeURIComponent(lid)}` : ""
  }`;
  const res = await fetch(`/api/annotatie/artikel?${q}`, { cache: "no-store" });
  return json<GraafArtikel>(res);
}

// --- Gebruikersfeedback -------------------------------------------------------

export async function stuurFeedback(body: {
  categorie: string;
  tekst: string;
  pagina?: string;
}): Promise<{ id: number }> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<{ id: number }>(res);
}

// --- Admin: gebruikersfeedback -----------------------------------------------

export interface FeedbackItem {
  id: number;
  client_id: string;
  userid: string;
  categorie: string;
  tekst: string;
  pagina: string | null;
  created: string;
}

export interface FeedbackPaginaOut {
  items: FeedbackItem[];
  totaal: number;
}

export async function getFeedback(offset = 0, limit = 50): Promise<FeedbackPaginaOut> {
  const res = await fetch(
    `/api/admin/feedback?offset=${offset}&limit=${limit}`,
    { cache: "no-store" },
  );
  return json<FeedbackPaginaOut>(res);
}

export async function getOngelezenFeedbackAantal(): Promise<number> {
  const res = await fetch("/api/admin/feedback/ongelezen-aantal", { cache: "no-store" });
  const data = await json<{ aantal: number }>(res);
  return data.aantal;
}

export async function markeerFeedbackGezien(tot?: string): Promise<void> {
  const res = await fetch("/api/admin/feedback/markeer-gezien", {
    method: "POST",
    headers: tot ? { "Content-Type": "application/json" } : {},
    body: tot ? JSON.stringify({ tot }) : undefined,
  });
  if (!res.ok) throw await parseError(res);
}

export async function verwijderFeedback(id: number): Promise<void> {
  const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

// --- Berichtensysteem (analist) ----------------------------------------------

export async function listBerichten(): Promise<BerichtOut[]> {
  const data = await json<BerichtenPaginaOut>(
    await fetch("/api/berichten?ongelezen=true&per_pagina=100", { cache: "no-store" }),
  );
  return data.items;
}

export async function listBerichtenPagina(pagina: number): Promise<BerichtenPaginaOut> {
  return json<BerichtenPaginaOut>(
    await fetch(`/api/berichten?pagina=${pagina}`, { cache: "no-store" }),
  );
}

export async function getOngelezenAantal(): Promise<OngelezenAantalOut> {
  return json<OngelezenAantalOut>(
    await fetch("/api/berichten/ongelezen-aantal", { cache: "no-store" }),
  );
}

export async function markeerAllesGelezen(): Promise<void> {
  const res = await fetch("/api/berichten/lees-alles", { method: "POST" });
  if (!res.ok) throw await parseError(res);
}

// --- Berichtensysteem (admin) ------------------------------------------------

export async function listAlleBerichten(pagina = 1, perPagina = 20): Promise<AdminBerichtenPaginaOut> {
  return json<AdminBerichtenPaginaOut>(
    await fetch(`/api/admin/berichten?pagina=${pagina}&per_pagina=${perPagina}`, { cache: "no-store" }),
  );
}

export async function maakBericht(body: BerichtAanmakenIn): Promise<AdminBerichtOut> {
  return json<AdminBerichtOut>(
    await fetch("/api/admin/berichten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function updateBericht(id: number, body: BerichtAanmakenIn): Promise<AdminBerichtOut> {
  return json<AdminBerichtOut>(
    await fetch(`/api/admin/berichten/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function zetPublicatie(id: number, gepubliceerd: boolean): Promise<AdminBerichtOut> {
  const body: BerichtPublicatieIn = { gepubliceerd };
  return json<AdminBerichtOut>(
    await fetch(`/api/admin/berichten/${id}/publicatie`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function verwijderBericht(id: number): Promise<void> {
  const res = await fetch(`/api/admin/berichten/${id}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}
