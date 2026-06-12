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
  Rapport,
  StartRequest,
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
