// Client-side fetch-helpers. Praten UITSLUITEND met de eigen Next.js-origin (/api/**);
// de BFF-laag injecteert het token server-side. Hier dus geen Authorization-header.

import type {
  Analyse2,
  Analyse3,
  ApiError,
  AppSettings,
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

// --- Login (pre-check vóór de Auth.js-sessie) -------------------------------

/** Pre-check: kloppen de gegevens (op userid), en is 2FA vereist? Zet zelf geen sessie. */
export async function loginVerify(
  userid: string,
  password: string,
  totp?: string,
): Promise<LoginVerifyResult> {
  const res = await fetch("/api/login-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid, password, totp: totp ?? null }),
  });
  if (!res.ok) {
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

export async function setCaptureLlmCalls(aan: boolean): Promise<AppSettings> {
  const res = await fetch("/api/admin/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capture_llm_calls: aan }),
  });
  return json<AppSettings>(res);
}

export async function getLlmCalls(projectId: string): Promise<LlmCall[]> {
  const res = await fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/llm-calls`, {
    cache: "no-store",
  });
  return json<LlmCall[]>(res);
}
