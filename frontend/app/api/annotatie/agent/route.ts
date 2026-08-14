// BFF-route voor de unified agent: SSE-passthrough naar graph-qa /v1/chat. De workbench stuurt een
// vrije prompt ("annoteer artikel 9 lid 1 IW"); de supervisor kiest de annotatie-worker, haalt de
// tekst via de tools op en streamt `doel` + `element`-events. Loopt bewust NIET via proxy() (buffert).

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
    upstream = await fetch(`${graphQaBaseUrl()}/v1/chat`, {
      method: "POST",
      headers: { ...graphQaAuthHeader(), "Content-Type": "application/json", Accept: "text/event-stream" },
      body,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    // Bewust JSON en géén SSE-frame. De stroom is nooit begonnen, dus de client zit nog in
    // `if (!res.ok) throw await parseError(res)` en komt aan de frames niet toe: een SSE-body bij een
    // 502 werd stilzwijgend weggegooid en de gebruiker las "Bad Gateway" in plaats van wat er aan de
    // hand was. Eén foutkanaal per antwoord — hetzelfde als de artikel-route hiernaast.
    const verlopen = (err as Error).name === "TimeoutError";
    logger.warn(verlopen ? "Agent-proxy: geen antwoord op tijd" : "Agent-proxy: onbereikbaar", {
      fout: (err as Error).message,
    });
    return Response.json(
      {
        detail: verlopen
          ? `De agent antwoordde niet binnen ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)} seconden.`
          : `Agent onbereikbaar (${(err as Error).message})`,
      },
      { status: verlopen ? 504 : 502 },
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
