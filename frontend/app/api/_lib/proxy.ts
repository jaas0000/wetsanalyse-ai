// Kern van de BFF: forward een request naar de upstream-API met server-side token-injectie,
// en geef de upstream-status + body ONGEWIJZIGD terug (incl. 401/404/409/429/503 en de
// Retry-After / Location headers), zodat de client correcte foutafhandeling houdt.

import { apiBaseUrl, authHeader } from "@/lib/config";

const PASS_THROUGH_HEADERS = ["retry-after", "location", "content-type"];

interface ProxyInit {
  method?: string;
  /** Rauwe request-body (al als string/Buffer); voor POST met JSON. */
  body?: BodyInit;
  /** Extra headers naar de upstream (bv. Content-Type). */
  headers?: Record<string, string>;
}

export async function proxy(path: string, init: ProxyInit = {}): Promise<Response> {
  const upstreamUrl = `${apiBaseUrl()}${path}`;
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: init.method ?? "GET",
      headers: { ...authHeader(), ...(init.headers ?? {}) },
      body: init.body,
      cache: "no-store",
    });
  } catch (err) {
    return Response.json(
      { detail: `API onbereikbaar: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Stream de body door en kopieer relevante headers.
  const headers = new Headers();
  for (const h of PASS_THROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, h === "location" ? rewriteLocation(v) : v);
  }
  const buf = await upstream.arrayBuffer();
  return new Response(buf.byteLength ? buf : null, {
    status: upstream.status,
    headers,
  });
}

/** Vertaal een upstream Location (/v1/projects/{id}) naar de eigen BFF-route. */
function rewriteLocation(loc: string): string {
  return loc.replace(/^.*\/v1\/projects\//, "/api/projects/");
}

/** Helper om de JSON-body van een inkomend request door te sturen. */
export async function readBody(req: Request): Promise<string> {
  return req.text();
}
