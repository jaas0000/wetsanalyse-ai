// Client-side fetch-helpers. Praten UITSLUITEND met de eigen Next.js-origin (/api/**);
// de BFF-laag injecteert het token server-side. Hier dus geen Authorization-header.

import type {
  Analyse2,
  Analyse3,
  ApiError,
  CreateAccepted,
  Feedback,
  FeedbackAccepted,
  Job,
  JobSummary,
  LlmProfileIn,
  LlmProfileOut,
  ProfileChoice,
  Rapport,
  StartRequest,
  TestResult,
  UsageReport,
} from "./types";

async function parseError(res: Response): Promise<ApiError> {
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
  const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
  return json<Job>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw await parseError(res);
}

export async function sendFeedback(id: string, body: Feedback): Promise<FeedbackAccepted> {
  const res = await fetch(`/api/projects/${id}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<FeedbackAccepted>(res);
}

export async function retryProject(id: string): Promise<CreateAccepted> {
  const res = await fetch(`/api/projects/${id}/retry`, { method: "POST" });
  return json<CreateAccepted>(res);
}

export async function getRapport(id: string): Promise<Rapport> {
  const res = await fetch(`/api/projects/${id}/rapport`, { cache: "no-store" });
  return json<Rapport>(res);
}

export async function getRonde(id: string, act: "2" | "3", n: number): Promise<Analyse2 | Analyse3> {
  const res = await fetch(`/api/projects/${id}/ronde/${act}/${n}`, { cache: "no-store" });
  return json<Analyse2 | Analyse3>(res);
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "status" in e && "detail" in e;
}

/** Keuzelijst modelprofielen (niet-admin) — live opgehaald zodat wijzigingen direct meekomen. */
export async function listModelProfiles(): Promise<ProfileChoice[]> {
  const res = await fetch("/api/profiles", { cache: "no-store" });
  return json<ProfileChoice[]>(res);
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
