// Server-side helpers voor Server Components: praten rechtstreeks (server→server) met de API,
// zodat de initiële render geen extra self-fetch via de BFF-route nodig heeft. Het token komt
// uit lib/config (server-only). NOOIT importeren vanuit een Client Component.

import "server-only";
import { apiBaseUrl, authHeader } from "./config";
import { pathSegment } from "./url";
import type { Job, JobSummary, Rapport } from "./types";

async function serverGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { ...authHeader() },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status} op ${path}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export function getProjectsServer(limit = 50, offset = 0): Promise<JobSummary[]> {
  return serverGet<JobSummary[]>(`/v1/projects?limit=${limit}&offset=${offset}`);
}

export function getProjectServer(id: string): Promise<Job> {
  return serverGet<Job>(`/v1/projects/${pathSegment(id)}`);
}

export function getRapportServer(id: string): Promise<Rapport> {
  return serverGet<Rapport>(`/v1/projects/${pathSegment(id)}/rapport`);
}

// --- Auth (server→server; aangeroepen door auth.ts en de login/setup-pagina's) ---------------

export interface VerifyResult {
  ok: boolean;
  code: string; // "" | "invalid" | "totp_required"
  userid: string;
  email: string;
  role: "beheerder" | "analist" | "";
}

/** Valideer inloggegevens (op userid) bij de API. Gebruikt door de Auth.js Credentials-provider. */
export async function verifyCredentials(
  userid: string,
  password: string,
  totp?: string,
): Promise<VerifyResult> {
  const res = await fetch(`${apiBaseUrl()}/v1/auth/verify`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ userid, password, totp: totp ?? null }),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, code: res.status === 429 ? "rate" : "invalid", userid: "", email: "", role: "" };
  return (await res.json()) as VerifyResult;
}

/** Is er nog geen enkel account? Dan staat de eenmalige registratie open. */
export async function getSetupStatus(): Promise<{ needs_setup: boolean }> {
  try {
    return await serverGet<{ needs_setup: boolean }>(`/v1/auth/setup-status`);
  } catch {
    // API onbereikbaar: ga uit van "geen setup nodig" zodat we niet onbedoeld registratie openen.
    return { needs_setup: false };
  }
}
