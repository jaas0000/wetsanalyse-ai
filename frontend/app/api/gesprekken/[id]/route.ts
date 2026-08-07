import { proxy } from "@/app/api/_lib/proxy";
import { geenSessie, sessionUserId } from "@/app/api/_lib/session";
import { graphQaAuthHeader, graphQaBaseUrl } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pathSegment } from "@/lib/url";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Wis óók het agent-geheugen (graph-qa checkpointer-thread) van dit gesprek. Best-effort: een falen mag
 *  de UI-delete niet blokkeren — de API-berichten zijn dan al weg; de checkpointer-thread ruimt anders
 *  later op (of blijft hooguit ongebruikt staan). */
async function wisAgentGeheugen(id: string): Promise<void> {
  try {
    await fetch(`${graphQaBaseUrl()}/v1/conversations/${pathSegment(id)}`, {
      method: "DELETE",
      headers: { ...graphQaAuthHeader() },
      cache: "no-store",
    });
  } catch (err) {
    logger.warn("Agent-geheugen wissen mislukt", { fout: (err as Error).message });
  }
}

export async function GET(_req: Request, { params }: Params) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();
  const { id } = await params;
  return proxy(`/v1/gesprekken/${pathSegment(id)}`, { headers: { "X-User-Id": userid } });
}

export async function PATCH(req: Request, { params }: Params) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();
  const { id } = await params;
  return proxy(`/v1/gesprekken/${pathSegment(id)}`, {
    method: "PATCH",
    body: await req.text(),
    headers: { "X-User-Id": userid, "Content-Type": "application/json" },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();
  const { id } = await params;
  const res = await proxy(`/v1/gesprekken/${pathSegment(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userid },
  });
  // Alleen het agent-geheugen wissen als de API-delete slaagde (2xx) — niet bij 404/andermans gesprek.
  if (res.ok) await wisAgentGeheugen(id);
  return res;
}
