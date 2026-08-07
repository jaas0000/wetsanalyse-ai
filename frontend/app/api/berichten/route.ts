import { proxy } from "../_lib/proxy";
import { geenSessie, sessionUserId } from "../_lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();
  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  const pagina = searchParams.get("pagina");
  const per_pagina = searchParams.get("per_pagina");
  const ongelezen = searchParams.get("ongelezen");
  if (pagina) params.set("pagina", pagina);
  if (per_pagina) params.set("per_pagina", per_pagina);
  if (ongelezen) params.set("ongelezen", ongelezen);
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return proxy(`/v1/berichten${qs}`, { headers: { "X-User-Id": userid } });
}
