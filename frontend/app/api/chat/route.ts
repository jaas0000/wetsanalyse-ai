// BFF-route voor de kennisgraaf-chatbot: proxy naar de API (/v1/chat), die server-side de
// n8n-agent aanroept. De webhook-URL + het secret staan in de API-settings (beheerbaar via
// /beheer) en blijven server-side. Gated door de middleware (/api/* alleen voor ingelogden).

import { proxy, readBody } from "../_lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readBody(req);
  return proxy("/v1/chat", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
