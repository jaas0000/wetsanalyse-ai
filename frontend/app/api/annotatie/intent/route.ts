// BFF-route voor de agent-ingang: proxy naar graph-qa (/v1/annoteer/intent). Parseert een vrije
// vraag ("annoteer art. 9 lid 1 IW") naar een doel + bevestiging (gewone JSON, geen SSE). Loopt —
// net als de annoteer-route — rechtstreeks naar graph-qa; het token gaat server-side mee.

import { graphQaAuthHeader, graphQaBaseUrl } from "@/lib/config";
import { logger } from "@/lib/logger";
import { geenSessie, sessionUserId } from "@/app/api/_lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();

  const body = await req.text();
  try {
    const upstream = await fetch(`${graphQaBaseUrl()}/v1/annoteer/intent`, {
      method: "POST",
      headers: { ...graphQaAuthHeader(), "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    logger.warn("Intent-proxy: agent onbereikbaar", { fout: (err as Error).message });
    return Response.json({ detail: `Agent onbereikbaar (${(err as Error).message})` }, { status: 502 });
  }
}
