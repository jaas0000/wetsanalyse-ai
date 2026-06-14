import Link from "next/link";
import { getProjectsServer } from "@/lib/server";
import { StateBadge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { pathSegment } from "@/lib/url";
import type { JobSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function formatDatum(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ProjectenPagina() {
  let projecten: JobSummary[] = [];
  let fout: string | null = null;
  try {
    projecten = await getProjectsServer();
  } catch (e) {
    fout = (e as Error).message;
  }

  return (
    <div className="animate-rise space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Analyses</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Elke analyse duidt één wetsartikel (of lid) brongetrouw volgens het Juridisch
            Analyseschema: markeren &amp; classificeren, daarna begrippen &amp; afleidingsregels.
          </p>
        </div>
        <LinkButton href="/nieuw" className="w-full sm:w-auto sm:self-start">
          Nieuwe analyse
        </LinkButton>
      </div>

      {fout && (
        <Card className="border-accent/30 bg-accent/5 p-4 text-sm text-accent">
          De API is niet bereikbaar: <span className="font-mono">{fout}</span>. Controleer{" "}
          <span className="font-mono">API_BASE_URL</span> en het token.
        </Card>
      )}

      {!fout && projecten.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="font-display text-lg text-ink">Nog geen analyses</p>
          <p className="max-w-md text-sm text-muted">
            Start je eerste analyse: kies een BWB-id en een artikel, en de orchestrator haalt de
            actuele wettekst op en begeleidt je door de review-lus.
          </p>
          <LinkButton href="/nieuw" className="mt-2 w-full sm:w-auto">
            Eerste analyse starten
          </LinkButton>
        </Card>
      )}

      {projecten.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Naam</th>
                <th className="px-4 py-3 font-medium">Bron</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {projecten.map((p) => (
                <tr
                  key={p.id}
                  className="group border-b border-line/60 last:border-0 transition-colors hover:bg-paper/60"
                >
                  <td className="px-4 py-3">
                    <Link href={`/projecten/${pathSegment(p.id)}`} className="block">
                      <span className="font-medium text-ink group-hover:text-accent">
                        {p.naam || p.id}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-faint">{p.id}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <span className="font-mono text-xs">{p.bwbId || "—"}</span>
                    {p.artikel && <span className="ml-1 text-xs">art. {p.artikel}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StateBadge state={p.state} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDatum(p.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  );
}
