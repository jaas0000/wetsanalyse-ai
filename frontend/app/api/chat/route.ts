// BFF-route voor de kennisgraaf-chatbot: SSE-passthrough naar de API (/v1/chat), die server-side
// de n8n-agent aanroept en het antwoord als text/event-stream teruggeeft (heartbeats tijdens het
// wachten, dan één data:-event). Loopt bewust NIET via proxy() — die buffert en breekt de stream.
// De ingelogde userid gaat als vertrouwde X-User-Id mee (per-gebruiker rate-limit in de API).

import { apiBaseUrl, authHeader } from "@/lib/config";
import { geenSessie, sessionUserId } from "../_lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();

  const body = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl()}/v1/chat`, {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
        "X-User-Id": userid,
        Accept: "text/event-stream",
      },
      body,
      signal: req.signal, // client-disconnect propageren naar de upstream
      cache: "no-store",
    });
  } catch (err) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ detail: `Assistent onbereikbaar (${(err as Error).message})` })}\n\n`,
      { status: 502, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  // Fouten vóór de stream (403 uit / 400 leeg / 429 rate-limit) komen als JSON terug → status +
  // body ongewijzigd doorgeven zodat de client de melding toont.
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    const headers = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
    const ra = upstream.headers.get("retry-after");
    if (ra) headers.set("Retry-After", ra);
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
