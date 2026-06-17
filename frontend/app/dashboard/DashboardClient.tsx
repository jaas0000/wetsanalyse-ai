"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardCard } from "@/components/DashboardCard";
import { Card } from "@/components/ui/Card";
import { Button, LinkButton } from "@/components/ui/Button";
import { ProjectControls } from "@/components/ProjectControls";
import { Pagination } from "@/components/Pagination";
import { statusBucket } from "@/lib/states";
import { useProjectenStream } from "@/lib/useProjectenStream";
import {
  DEFAULT_FILTERS,
  distinctWetten,
  filterEnSorteer,
  paginate,
  type ProjectFilters,
  type StatusFilter,
} from "@/lib/projectFilter";
import type { JobSummary } from "@/lib/types";

const PAGE_SIZE = 12;
const DASHBOARD_DEFAULTS: ProjectFilters = { ...DEFAULT_FILTERS, sort: "status" };

const TELLERS = [
  { key: "lopend", label: "lopend", kleur: "text-lint" },
  { key: "review", label: "review", kleur: "text-gold" },
  { key: "klaar", label: "klaar", kleur: "text-succes" },
  { key: "fout", label: "fout", kleur: "text-fout" },
] as const;

export function DashboardClient({ initieel }: { initieel: JobSummary[] }) {
  const { items, verbonden } = useProjectenStream(initieel);

  // De 'verstreken tijd'-klok tikt per kaart (DashboardCard), niet hier — zo herberekent dit
  // dashboard niet elke seconde de afleidingen hieronder. Memoïseer ze bovendien zodat ze alleen
  // herrekenen bij echte data-/filterwijzigingen.
  const all = useMemo(() => [...items.values()], [items]);
  const [filters, setFilters] = useState<ProjectFilters>(DASHBOARD_DEFAULTS);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters]);

  const wetten = useMemo(() => distinctWetten(all), [all]);
  const gefilterd = useMemo(() => filterEnSorteer(all, filters), [all, filters]);
  const { items: lijst, page: huidige, totalPages, total } = paginate(gefilterd, page, PAGE_SIZE);
  useEffect(() => {
    if (page !== huidige) setPage(huidige);
  }, [page, huidige]);

  // Tellers over álle items (niet de gefilterde) — ze dienen tegelijk als snelfilter.
  const tel = { lopend: 0, review: 0, klaar: 0, fout: 0 };
  for (const u of all) tel[statusBucket(u.state, u.error)]++;

  const toggleStatus = (s: StatusFilter) =>
    setFilters((f) => ({ ...f, status: f.status === s ? "alle" : s }));

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-lint">Dashboard</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                verbonden ? "border-succes/40 bg-succes/5 text-succes" : "border-line text-faint"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${verbonden ? "animate-pulse bg-succes" : "bg-faint"}`}
              />
              {verbonden ? "live" : "verbinden…"}
            </span>
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Live overzicht van alle analyses — tot op functieniveau zichtbaar in welke stap de engine
            zit. Klik een teller om op status te filteren.
          </p>
        </div>
        <div className="flex gap-2">
          {TELLERS.map(({ key, label, kleur }) => {
            const actief = filters.status === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleStatus(key)}
                aria-pressed={actief}
                className={`rounded-button border px-3.5 py-2 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint ${
                  actief ? "border-lint bg-lint/5" : "border-line bg-surface hover:bg-paper"
                }`}
              >
                <div className={`text-lg font-semibold leading-none ${kleur}`}>{tel[key]}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {all.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="font-display text-lg text-ink">Nog geen analyses</p>
          <p className="max-w-md text-sm text-muted">
            Zodra je een analyse start, verschijnt hier live de voortgang.
          </p>
          <LinkButton href="/nieuw" className="mt-2">
            Nieuwe analyse
          </LinkButton>
        </Card>
      ) : (
        <>
          <ProjectControls
            filters={filters}
            onChange={setFilters}
            wetten={wetten}
            showStatus={false}
          />

          {gefilterd.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-muted">Geen analyses gevonden met deze filters.</p>
              <Button variant="secondary" size="sm" onClick={() => setFilters(DASHBOARD_DEFAULTS)}>
                Filters wissen
              </Button>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {lijst.map((u) => (
                  <DashboardCard key={u.id} u={u} />
                ))}
              </div>
              <Pagination
                page={huidige}
                totalPages={totalPages}
                total={total}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
