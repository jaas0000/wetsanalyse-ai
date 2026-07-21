// BFF-route voor de annotatie-agent: SSE-passthrough naar graph-qa (/v1/annoteer), die de JAS-
// elementen voor een artikel voorstelt en als text/event-stream teruggeeft. Loopt bewust NIET via
// proxy() (die buffert) en NIET via de api (frontend orkestreert: state via de api, agent via
// graph-qa). Het graph-qa-token gaat server-side mee; de client ziet het nooit.

import { graphQaAuthHeader, graphQaBaseUrl } from "@/lib/config";
import { logger } from "@/lib/logger";
import { geenSessie, sessionUserId } from "@/app/api/_lib/session";

export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 300_000;

export async function POST(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();

  const body = await req.text();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
  let upstream: Response;
  try {
    upstream = await fetch(`${graphQaBaseUrl()}/v1/annoteer`, {
      method: "POST",
      headers: {
        ...graphQaAuthHeader(),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    logger.warn("Annoteer-proxy: agent onbereikbaar", { fout: (err as Error).message });
    return new Response(
      `event: error\ndata: ${JSON.stringify({ detail: `Agent onbereikbaar (${(err as Error).message})` })}\n\n`,
      { status: 502, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const headers = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
    return new Response(text || null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
