import { proxy } from "../_lib/proxy";
import { geenSessie, sessionUserId } from "../_lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();
  const body = await req.text();
  return proxy("/v1/feedback", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "X-User-Id": userid },
  });
}
