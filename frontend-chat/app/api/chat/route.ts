// SSE-proxy naar graph-qa /v1/chat — de kern van de chat-app.
import { chatAuthHeader, chatApiBaseUrl } from "@/lib/config";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 300_000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ detail: "Niet ingelogd." }, { status: 401 });
  }

  const body = await req.text();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);

  let upstream: Response;
  try {
    upstream = await fetch(`${chatApiBaseUrl()}/v1/chat`, {
      method: "POST",
      headers: {
        ...chatAuthHeader(),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    const msg = (err as Error).message;
    return new Response(
      `event: error\ndata: ${JSON.stringify({ detail: `Agent onbereikbaar (${msg})` })}\n\n`,
      { status: 502, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
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
