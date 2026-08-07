import { proxy, readBody } from "../../_lib/proxy";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/v1/admin/berichten", { admin: true });
}

export async function POST(req: Request) {
  const body = await readBody(req);
  return proxy("/v1/admin/berichten", {
    method: "POST",
    body,
    admin: true,
    headers: { "Content-Type": "application/json" },
  });
}
