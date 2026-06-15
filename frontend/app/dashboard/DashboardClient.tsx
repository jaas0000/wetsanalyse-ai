"use client";

import { useEffect, useState } from "react";
import { DashboardCard } from "@/components/DashboardCard";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { isReview } from "@/lib/states";
import type { DashboardUpdate, JobSummary } from "@/lib/types";

/** Beginstand uit de SSR-lijst; de aggregate-SSE verrijkt/overschrijft dit binnen enkele seconden. */
function summaryNaarUpdate(s: JobSummary): DashboardUpdate {
  return {
    id: s.id,
    naam: s.naam,
    bwbId: s.bwbId,
    artikel: s.artikel,
    state: s.state,
    current_activiteit: null,
    current_ronde: 0,
    current_fase: s.current_fase ?? null,
    current_fase_sinds: null,
    created: s.updated,
    updated: s.updated,
    model_profile: s.model_profile ?? "",
    tokens_in: s.tokens_in ?? 0,
    tokens_out: s.tokens_out ?? 0,
    error: null,
  };
}

// Sorteervolgorde: lopend/review boven (vraagt aandacht), dan fout, dan klaar.
function rang(u: DashboardUpdate): number {
  if (u.state === "fout" || u.error) return 1;
  if (isReview(u.state) || u.state.endsWith("runt") || u.state === "bouwt" || u.state === "queued") return 0;
  return 2; // klaar
}

export function DashboardClient({ initieel }: { initieel: JobSummary[] }) {
  const [items, setItems] = useState<Map<string, DashboardUpdate>>(
    () => new Map(initieel.map((s) => [s.id, summaryNaarUpdate(s)])),
  );
  const [now, setNow] = useState(() => Date.now());
  const [verbonden, setVerbonden] = useState(false);

  // Eén aggregate-stream voor alle projecten; de browser herverbindt zelf na de 10-min servercap.
  useEffect(() => {
    const es = new EventSource("/api/projects/events");
    es.onopen = () => setVerbonden(true);
    es.onmessage = (e) => {
      try {
        const u = JSON.parse(e.data) as DashboardUpdate;
        setItems((prev) => new Map(prev).set(u.id, u));
      } catch {
        /* niet-JSON keepalive/regel — negeren */
      }
    };
    es.addEventListener("removed", (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
        setItems((prev) => {
          const m = new Map(prev);
          m.delete(id);
          return m;
        });
      } catch {
        /* negeren */
      }
    });
    es.onerror = () => setVerbonden(false); // browser herverbindt automatisch
    return () => es.close();
  }, []);

  // Lokale klok voor 'verstreken tijd' — puur weergave, geen netwerk.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lijst = [...items.values()].sort((a, b) => {
    const r = rang(a) - rang(b);
    return r !== 0 ? r : (b.updated || "").localeCompare(a.updated || "");
  });

  const tel = { lopend: 0, review: 0, klaar: 0, fout: 0 };
  for (const u of items.values()) {
    if (u.state === "fout" || u.error) tel.fout++;
    else if (isReview(u.state)) tel.review++;
    else if (u.state === "klaar") tel.klaar++;
    else tel.lopend++;
  }

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-ink">Dashboard</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                verbonden ? "border-[#3a7a3a]/40 bg-[#3a7a3a]/5 text-[#3a7a3a]" : "border-line text-faint"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${verbonden ? "animate-pulse bg-[#3a7a3a]" : "bg-faint"}`} />
              {verbonden ? "live" : "verbinden…"}
            </span>
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Live overzicht van alle analyses — tot op functieniveau zichtbaar in welke stap de engine
            zit.
          </p>
        </div>
        <div className="flex gap-2">
          {([
            ["lopend", tel.lopend, "text-accent"],
            ["review", tel.review, "text-gold"],
            ["klaar", tel.klaar, "text-[#3a7a3a]"],
            ["fout", tel.fout, "text-accent"],
          ] as const).map(([label, n, kleur]) => (
            <div key={label} className="rounded-xl border border-line bg-surface px-3.5 py-2 text-center">
              <div className={`text-lg font-semibold leading-none ${kleur}`}>{n}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {lijst.length === 0 ? (
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {lijst.map((u) => (
            <DashboardCard key={u.id} u={u} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
