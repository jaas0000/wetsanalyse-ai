"use client";

import Link from "next/link";
import { StateBadge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useProjectenStream } from "@/lib/useProjectenStream";
import { pathSegment } from "@/lib/url";
import type { JobSummary } from "@/lib/types";

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

/** Live projectenlijst: geseed uit de SSR-render, daarna bijgewerkt via de gedeelde aggregate-SSE
 *  (nieuwe analyses verschijnen vanzelf, statussen lopen mee, verwijderde rijen verdwijnen) — zodat
 *  de home-lijst niet meer op een harde refresh leunt. */
export function ProjectenLijstClient({ initieel }: { initieel: JobSummary[] }) {
  const { items } = useProjectenStream(initieel);
  const lijst = [...items.values()].sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));

  if (lijst.length === 0) {
    return (
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
    );
  }

  return (
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
            {lijst.map((p) => (
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
  );
}
