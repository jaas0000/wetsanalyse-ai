// Proxy naar graph-qa /v1/artikel — haalt wettekst op voor annotatie-modus.
import { chatAuthHeader, chatApiBaseUrl } from "@/lib/config";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ detail: "Niet ingelogd." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const bwbId = searchParams.get("bwb_id") ?? "";
  const artikel = searchParams.get("artikel") ?? "";
  const lid = searchParams.get("lid") ?? "";

  const url =
    `${chatApiBaseUrl()}/v1/artikel?bwb_id=${encodeURIComponent(bwbId)}&artikel=${encodeURIComponent(artikel)}` +
    (lid ? `&lid=${encodeURIComponent(lid)}` : "");

  try {
    const upstream = await fetch(url, { headers: chatAuthHeader(), cache: "no-store" });
    const text = await upstream.text();
    return new Response(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    logger.warn("Artikel-proxy: agent onbereikbaar", { fout: (err as Error).message });
    return Response.json(
      { detail: `Agent onbereikbaar (${(err as Error).message})` },
      { status: 502 }
    );
  }
}
