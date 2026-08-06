import { proxy } from "@/app/api/_lib/proxy";
import { geenSessie, sessionUserId } from "@/app/api/_lib/session";
import { pathSegment } from "@/lib/url";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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
  return proxy(`/v1/gesprekken/${pathSegment(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userid },
  });
}
