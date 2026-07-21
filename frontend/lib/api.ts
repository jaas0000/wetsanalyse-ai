// Client-side fetch-helpers. Praten UITSLUITEND met de eigen Next.js-origin (/api/**);
// de BFF-laag injecteert het token server-side. Hier dus geen Authorization-header.

import type {
  Analyse2,
  Analyse3,
  ApiError,
  ApiTokenCreated,
  ApiTokenOut,
  AppSettings,
  ArtikelInfo,
  CreateAccepted,
  LlmCall,
  Feedback,
  FeedbackAccepted,
  Job,
  JobSummary,
  LlmProfileIn,
  LlmProfileOut,
  LoginVerifyResult,
  MeAccount,
  ProfileChoice,
  Rapport,
  RegelspraakModel,
  RegelspraakStart,
  Role,
  SettingsUpdate,
  StartRequest,
  TempPassword,
  TestResult,
  TotpBegin,
  UsageReport,
  UserCreated,
  UserOut,
  WetChoice,
  WetIn,
  WetOut,
  WetResolveResult,
  WetStructuur,
} from "./types";
import type {
  AnnotatieDocument,
  AuditRecord,
  BeslissingInvoer,
  DocumentCreate,
  DocumentSamenvatting,
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

/** Stuur een vraag naar de kennisgraaf-assistent (BFF → API → n8n-agent). Het antwoord komt als
 *  SSE-stream binnen (heartbeats tijdens het wachten, dan één data:-event) zodat een lang antwoord
 *  niet tegen de proxytimeout loopt. De sessionId houdt de gesprekscontext vast. */
export async function sendChat(
  chatInput: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatInput, sessionId }),
    signal,
  });
  if (!res.ok) throw await parseError(res); // 403/400/429 komen als JSON-fout terug
  if (!res.body) throw { status: 0, detail: "Geen antwoordstroom." } as ApiError;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // De API stuurt vandaag één data:-frame, maar we lezen bewust dóór tot het stream-einde en houden
  // het laatste antwoord vast — zo pakt een toekomstige multi-event-stream niet stil alleen het
  // eerste frame. Een error-frame breekt wél meteen af.
  let antwoord = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // sse-starlette (graph-qa) scheidt frames met \r\n; strip de CR zodat indexOf("\n\n") de
      // frame-grens vindt (robuust over chunk-grenzen — een losse \r blijft nooit hangen).
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let scheiding: number;
      while ((scheiding = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, scheiding);
        buffer = buffer.slice(scheiding + 2);
        let event = "message";
        let data = "";
        for (const regel of frame.split("\n")) {
          if (regel.startsWith(":")) continue; // heartbeat-commentaar
          if (regel.startsWith("event:")) event = regel.slice(6).trim();
          else if (regel.startsWith("data:")) data += regel.slice(5).trim();
        }
        if (event === "error") {
          throw { status: 502, detail: veiligJson(data)?.detail ?? "Er ging iets mis." } as ApiError;
        }
        if (data) antwoord = veiligJson(data)?.answer ?? antwoord;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return antwoord;
}

/** Of de chat-host bereikbaar is (voedt het status-stipje op de chatbel). Booleans; nooit throwen —
 *  een fout telt als "niet gezond". */
export async function getChatHealth(): Promise<{ enabled: boolean; healthy: boolean }> {
  try {
    const res = await fetch("/api/chat/health", { cache: "no-store" });
    if (!res.ok) return { enabled: false, healthy: false };
    return (await res.json()) as { enabled: boolean; healthy: boolean };
  } catch {
    return { enabled: false, healthy: false };
  }
}

function veiligJson(s: string): { answer?: string; detail?: string } | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function createProject(body: StartRequest): Promise<CreateAccepted> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<CreateAccepted>(res);
}

export async function listProjects(): Promise<JobSummary[]> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  return json<JobSummary[]>(res);
}

export async function getProject(id: string): Promise<Job> {
  const res = await fetch(`/api/projects/${pathSegment(id)}`, { cache: "no-store" });
  return json<Job>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${pathSegment(id)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

export async function sendFeedback(id: string, body: Feedback): Promise<FeedbackAccepted> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<FeedbackAccepted>(res);
}

export async function retryProject(id: string): Promise<CreateAccepted> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/retry`, { method: "POST" });
  return json<CreateAccepted>(res);
}

export async function getRapport(id: string): Promise<Rapport> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/rapport`, { cache: "no-store" });
  return json<Rapport>(res);
}

export async function getRonde(
  id: string,
  act: "2" | "3" | "rs-gegevens" | "rs-regels",
  n: number,
): Promise<Analyse2 | Analyse3> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/ronde/${act}/${n}`, { cache: "no-store" });
  return json<Analyse2 | Analyse3>(res);
}

/** Voer activiteit 3 alsnog uit op een analyse die na activiteit 2 is afgerond (scope act2). */
export async function startAct3(id: string): Promise<CreateAccepted> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/act3`, { method: "POST" });
  return json<CreateAccepted>(res);
}

export async function startRegelspraak(id: string, body: RegelspraakStart = {}): Promise<CreateAccepted> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/regelspraak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<CreateAccepted>(res);
}

export async function getRegelspraak(id: string): Promise<RegelspraakModel> {
  const res = await fetch(`/api/projects/${pathSegment(id)}/regelspraak`, { cache: "no-store" });
  return json<RegelspraakModel>(res);
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "status" in e && "detail" in e;
}

/** Keuzelijst modelprofielen (niet-admin) — live opgehaald zodat wijzigingen direct meekomen. */
export async function listModelProfiles(): Promise<ProfileChoice[]> {
  const res = await fetch("/api/profiles", { cache: "no-store" });
  return json<ProfileChoice[]>(res);
}

/** Keuzelijst wetten (niet-admin) voor de dropdown in het analyseformulier. */
export async function listWetten(): Promise<WetChoice[]> {
  const res = await fetch("/api/wetten", { cache: "no-store" });
  return json<WetChoice[]>(res);
}

/** Afgeplatte artikellijst van een wet — voedt de artikel-combobox (API cachet per uur). */
export async function getWetStructuur(bwbId: string): Promise<WetStructuur> {
  const res = await fetch(`/api/wetten/${pathSegment(bwbId)}/structuur`, { cache: "no-store" });
  return json<WetStructuur>(res);
}

/** Ledeninfo + opschrift/snippet van één artikel — voedt de lid-keuzelijst. */
export async function getArtikelInfo(bwbId: string, artikel: string): Promise<ArtikelInfo> {
  const res = await fetch(
    `/api/wetten/${pathSegment(bwbId)}/artikelen/${pathSegment(artikel)}`,
    { cache: "no-store" },
  );
  return json<ArtikelInfo>(res);
}

// --- Admin: LLM-modelprofielen + verbruik -----------------------------------

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

export async function getUsage(groupBy = "model"): Promise<UsageReport> {
  const res = await fetch(`/api/admin/usage?group_by=${encodeURIComponent(groupBy)}`, { cache: "no-store" });
  return json<UsageReport>(res);
}

// --- Admin: wet-catalogus ---------------------------------------------------

export async function listWetCatalog(): Promise<WetOut[]> {
  const res = await fetch("/api/admin/wetten", { cache: "no-store" });
  return json<WetOut[]>(res);
}

export async function saveWet(bwbId: string, body: WetIn): Promise<WetOut> {
  const res = await fetch(`/api/admin/wetten/${encodeURIComponent(bwbId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<WetOut>(res);
}

export async function deleteWet(bwbId: string): Promise<void> {
  const res = await fetch(`/api/admin/wetten/${encodeURIComponent(bwbId)}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

export async function resolveWetNaam(bwbId: string): Promise<WetResolveResult> {
  const res = await fetch(`/api/admin/wetten/${encodeURIComponent(bwbId)}/resolve`, { method: "POST" });
  return json<WetResolveResult>(res);
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

// --- runtime-instellingen + LLM-call-capture (admin) ------------------------

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch("/api/admin/settings", { cache: "no-store" });
  return json<AppSettings>(res);
}

/** Partiële update van de runtime-instellingen (capture-toggle en/of chat-config). */
export async function updateSettings(patch: SettingsUpdate): Promise<AppSettings> {
  const res = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return json<AppSettings>(res);
}

export function setCaptureLlmCalls(aan: boolean): Promise<AppSettings> {
  return updateSettings({ capture_llm_calls: aan });
}

export async function getLlmCalls(projectId: string): Promise<LlmCall[]> {
  const res = await fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/llm-calls`, {
    cache: "no-store",
  });
  return json<LlmCall[]>(res);
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

export async function zetElementen(slug: string, elementen: VoorstelElement[]): Promise<AnnotatieDocument> {
  const res = await fetch(`/api/annotatie/documenten/${pathSegment(slug)}/elementen`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elementen }),
  });
  return json<AnnotatieDocument>(res);
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

/** Stream de door de agent voorgestelde JAS-elementen (BFF → graph-qa, SSE). Roept `onElement` per
 *  voorstel; geeft de tellingen terug op `done`. `onStatus` is optioneel (voortgangsregels). */
export async function annoteerStream(
  bwbId: string,
  artikel: string,
  handlers: { onStatus?: (m: string) => void; onElement: (el: VoorstelElement) => void },
  signal?: AbortSignal,
): Promise<{ aantal: number; verworpen: number }> {
  const res = await fetch("/api/annotatie/annoteer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bwb_id: bwbId, artikel }),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw { status: 0, detail: "Geen annotatiestroom." } as ApiError;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let resultaat = { aantal: 0, verworpen: 0 };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // sse-starlette (graph-qa) scheidt frames met \r\n; strip de CR zodat indexOf("\n\n") de
      // frame-grens vindt (robuust over chunk-grenzen — een losse \r blijft nooit hangen).
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
          | { type: string; message?: string; element?: VoorstelElement; aantal?: number; verworpen?: number }
          | null;
        if (!ev) continue;
        if (ev.type === "status") handlers.onStatus?.(ev.message ?? "");
        else if (ev.type === "element" && ev.element) handlers.onElement(ev.element);
        else if (ev.type === "done") resultaat = { aantal: ev.aantal ?? 0, verworpen: ev.verworpen ?? 0 };
        else if (ev.type === "error") throw { status: 502, detail: ev.message ?? "Annotatie mislukt." } as ApiError;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return resultaat;
}
