import { proxy, readBody } from "../../../_lib/proxy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { name } = await params;
  return proxy(`/v1/admin/profiles/${encodeURIComponent(name)}`, { admin: true });
}

export async function PUT(req: Request, { params }: Params) {
  const { name } = await params;
  const body = await readBody(req);
  return proxy(`/v1/admin/profiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body,
    admin: true,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { name } = await params;
  return proxy(`/v1/admin/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
    admin: true,
  });
}
