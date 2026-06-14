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
