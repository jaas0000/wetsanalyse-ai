import { proxy } from "../../_lib/proxy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  return proxy(`/v1/projects/${encodeURIComponent(id)}`);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return proxy(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}
