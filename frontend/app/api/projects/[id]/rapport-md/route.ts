import { apiBaseUrl, authHeader } from "@/lib/config";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const upstream = await fetch(
    `${apiBaseUrl()}/v1/projects/${encodeURIComponent(id)}/rapport.md`,
    { headers: { ...authHeader() }, cache: "no-store" },
  );
  if (!upstream.ok) {
    return new Response(`Rapport (.md) niet beschikbaar (${upstream.status}).`, {
      status: upstream.status,
    });
  }
  const text = await upstream.text();
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.md"`,
    },
  });
}
