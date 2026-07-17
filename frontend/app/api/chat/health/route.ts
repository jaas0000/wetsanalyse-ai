// Of de chat-host bereikbaar is (voedt het status-stipje op de chatbel). Server-side gecachet in de
// API (~20s), dus pollen is licht. Alleen booleans; geen webhook/secret.

import { proxy } from "../../_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/v1/chat/health");
}
