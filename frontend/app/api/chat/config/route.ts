// Of de kennisgraaf-chatbot aanstaat (alleen de toggle; geen webhook/secret). Voedt de
// server-side gate die bepaalt of de chatbel wordt getoond.

import { proxy } from "../../_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/v1/chat/config");
}
