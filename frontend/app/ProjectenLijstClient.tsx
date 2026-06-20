"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StateBadge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProjectControls } from "@/components/ProjectControls";
import { Pagination } from "@/components/Pagination";
import { useProjectenStream } from "@/lib/useProjectenStream";
import { bronnenSamenvatting } from "@/lib/bronnen";
import { pathSegment } from "@/lib/url";
import {
  DEFAULT_FILTERS,
  distinctWetten,
  filterEnSorteer,
  paginate,
  type ProjectFilters,
} from "@/lib/projectFilter";
import type { JobSummary } from "@/lib/types";

const PAGE_SIZE = 25;

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
 *  (nieuwe analyses verschijnen vanzelf, statussen lopen mee, verwijderde rijen verdwijnen). Zoeken,
 *  filteren, sorteren en pagineren gebeuren client-side op de live lijst. */
export function ProjectenLijstClient({ initieel }: { initieel: JobSummary[] }) {
  const router = useRouter();
  const { items } = useProjectenStream(initieel);
  const all = [...items.values()];

  // Re-sync de SSR-lijst bij terugkeer naar het tabblad/venster: een analyse die elders is aangemaakt
  // (of de stand na een trage SSE-(her)verbinding) verschijnt zo meteen. Gethrottled zodat snel
  // wisselen niet bij elke event een refetch triggert; de verse `initieel` wordt door
  // `useProjectenStream` in de lijst opgenomen.
  const laatsteRefresh = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const nu = Date.now();
      if (nu - laatsteRefresh.current < 3000) return;
      laatsteRefresh.current = nu;
      router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  const [filters, setFilters] = useState<ProjectFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters]);

  const wetten = distinctWetten(all);
  const gefilterd = filterEnSorteer(all, filters);
  const { items: lijst, page: huidige, totalPages, total } = paginate(gefilterd, page, PAGE_SIZE);
  useEffect(() => {
    if (page !== huidige) setPage(huidige);
  }, [page, huidige]);

  if (all.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <p className="font-display text-lg text-ink">Nog geen analyses</p>
        <p className="max-w-md text-sm text-muted">
          Start je eerste analyse: kies een wet en één of meer artikelen voor je werkgebied. De
          orchestrator haalt de actuele wettekst op en begeleidt je door de review-lus.
        </p>
        <LinkButton href="/nieuw" className="mt-2 w-full sm:w-auto">
          Eerste analyse starten
        </LinkButton>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ProjectControls filters={filters} onChange={setFilters} wetten={wetten} />

      {gefilterd.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-muted">Geen analyses gevonden met deze filters.</p>
          <Button variant="secondary" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Filters wissen
          </Button>
        </Card>
      ) : (
        <>
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
                      className="group border-b border-line/60 last:border-0 transition-colors hover:bg-surface"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/projecten/${pathSegment(p.id)}`} className="block">
                          <span className="font-medium text-ink group-hover:text-link">
                            {p.naam || p.id}
                          </span>
                          <span className="mt-0.5 block font-mono text-xs text-faint">{p.id}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <span className="text-xs">{bronnenSamenvatting(p.bronnen)}</span>
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
          <Pagination
            page={huidige}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
