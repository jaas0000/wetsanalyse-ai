"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";
import { fasenVoor, faseLabel } from "@/lib/fasen";
import { isReview } from "@/lib/states";
import { pathSegment } from "@/lib/url";
import { retryProject, isApiError } from "@/lib/api";
import type { DashboardUpdate, JobState } from "@/lib/types";

// De zeven macro-stations (gelijk aan frontend/lib/states.ts, samengevouwen tot één rij lichtjes).
const STATIONS: { key: string; label: string; states: JobState[]; tint: Tint }[] = [
  { key: "queued", label: "Wachtrij", states: ["queued"], tint: "neutraal" },
  { key: "act2", label: "Act. 2", states: ["act2-runt"], tint: "werk" },
  { key: "rev2", label: "Review 2", states: ["wacht-op-review-act2"], tint: "review" },
  { key: "act3", label: "Act. 3", states: ["act3-runt"], tint: "werk" },
  { key: "rev3", label: "Review 3", states: ["wacht-op-review-act3"], tint: "review" },
  { key: "bouwt", label: "Rapport", states: ["bouwt"], tint: "bouw" },
  { key: "klaar", label: "Klaar", states: ["klaar"], tint: "klaar" },
];

type Tint = "neutraal" | "werk" | "review" | "bouw" | "klaar";
type Status = "gedaan" | "actief" | "komt" | "fout";

const GROEN = "#3a7a3a";

function stationIndex(state: JobState): number {
  return STATIONS.findIndex((s) => s.states.includes(state));
}

/** Lamp-styling per status; de actieve lamp pulseert en kleurt naar het stationstype. */
function lampClass(status: Status, tint: Tint): string {
  if (status === "fout") return "border-accent bg-accent";
  if (status === "gedaan") return "border-transparent";
  if (status === "komt") return "border-line bg-paper";
  // actief
  const kleur =
    tint === "review"
      ? "border-gold bg-gold"
      : tint === "bouw"
        ? "border-accent-soft bg-accent-soft"
        : tint === "klaar"
          ? "border-transparent"
          : "border-accent bg-accent";
  return `${kleur} animate-pulse ring-4 ring-accent/10`;
}

function formatDuur(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const u = Math.floor(m / 60);
  return `${u}u ${String(m % 60).padStart(2, "0")}m`;
}

function initialen(naam: string, bwbId: string): string {
  const bron = (naam || bwbId || "?").replace(/[^A-Za-z]/g, "");
  return (bron.slice(0, 2) || "??").toUpperCase();
}

export function DashboardCard({ u, now }: { u: DashboardUpdate; now: number }) {
  const [bezig, setBezig] = useState(false);
  const isFout = u.state === "fout" || !!u.error;
  const idx = stationIndex(u.state);
  const foutIdx = u.current_activiteit === "3" ? 3 : 1; // waar de analyse stokte
  const actief = !isFout && (u.state.endsWith("runt") || u.state === "bouwt");

  const fasen = fasenVoor(u.state);
  const faseIdx = u.current_fase ? fasen.indexOf(u.current_fase) : -1;

  const verstreken = formatDuur(now - new Date(u.created).getTime());
  const inFase =
    u.current_fase_sinds && actief
      ? formatDuur(now - new Date(u.current_fase_sinds).getTime())
      : null;

  async function onRetry() {
    setBezig(true);
    try {
      await retryProject(u.id);
    } catch (e) {
      alert(isApiError(e) ? e.detail : (e as Error).message);
    }
    setBezig(false);
  }

  return (
    <Card
      className={`overflow-hidden transition-shadow ${
        actief ? "shadow-sm ring-1 ring-accent/10" : ""
      } ${isFout ? "border-accent/40" : ""}`}
    >
      {/* Kop */}
      <div className="flex items-center gap-3 p-4">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border font-mono text-sm font-semibold ${
            isFout ? "border-accent/40 text-accent" : "border-line text-muted"
          }`}
        >
          {initialen(u.naam, u.bwbId)}
        </span>
        <div className="min-w-0">
          <Link href={`/projecten/${pathSegment(u.id)}`} className="block truncate font-medium text-ink hover:text-accent">
            {u.naam || `${u.bwbId} · art. ${u.artikel}`}
          </Link>
          <p className="truncate font-mono text-xs text-faint">
            {u.bwbId}
            {u.artikel ? ` · art. ${u.artikel}` : ""}
            {u.model_profile ? ` · ${u.model_profile}` : ""}
          </p>
        </div>
        <div className="ml-auto shrink-0">
          <StateBadge state={u.state} />
        </div>
      </div>

      {/* Macro-pijplijn */}
      <div className="flex items-start px-4 pb-3">
        {STATIONS.map((st, i) => {
          let status: Status;
          if (isFout) status = i < foutIdx ? "gedaan" : i === foutIdx ? "fout" : "komt";
          else if (u.state === "klaar") status = "gedaan";
          else status = i < idx ? "gedaan" : i === idx ? "actief" : "komt";

          return (
            <div key={st.key} className="relative flex flex-1 flex-col items-center">
              {i > 0 && (
                <span
                  className="absolute right-1/2 top-[7px] -z-0 h-0.5 w-full"
                  style={{ background: i <= idx || u.state === "klaar" ? GROEN : "rgb(var(--line))" }}
                />
              )}
              <span
                className={`relative z-10 h-4 w-4 rounded-full border-2 ${lampClass(status, st.tint)}`}
                style={status === "gedaan" ? { background: GROEN } : undefined}
              />
              <span
                className={`mt-1.5 text-center text-[10px] leading-tight ${
                  status === "actief" ? "font-medium text-ink" : status === "fout" ? "text-accent" : "text-faint"
                }`}
              >
                {st.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Functieniveau (alleen tijdens een runt/bouwt) */}
      {actief && fasen.length > 0 && (
        <div className="border-t border-line/60 bg-paper/40 px-4 py-3">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-faint">
            Functieniveau{u.current_fase ? <> · <span className="text-accent">{faseLabel(u.current_fase)}</span></> : null}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {fasen.map((f, i) => {
              const gedaan = faseIdx >= 0 && i < faseIdx;
              const bezigF = i === faseIdx;
              return (
                <span
                  key={f}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                    bezigF
                      ? "border-accent/40 bg-surface font-medium text-ink shadow-sm"
                      : gedaan
                        ? "border-line bg-surface text-muted"
                        : "border-line/60 text-faint"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: bezigF ? "rgb(var(--accent))" : gedaan ? GROEN : "rgb(var(--faint) / 0.5)" }}
                  />
                  {faseLabel(f)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Telemetrie */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line/60 px-4 py-2.5 text-xs text-muted">
        <span title="Verstreken sinds aanmaak">⏱ {verstreken}</span>
        {inFase && <span title="Tijd in huidige functiefase">fase {inFase}</span>}
        <span title="Tokens in/uit (provenance)" className="font-mono">
          {u.tokens_in.toLocaleString("nl-NL")} / {u.tokens_out.toLocaleString("nl-NL")} tok
        </span>
        {u.current_ronde > 0 && <span>ronde {u.current_ronde}</span>}
      </div>

      {/* Review-actie of fout + retry */}
      {!isFout && isReview(u.state) && (
        <Link
          href={`/projecten/${pathSegment(u.id)}`}
          className="flex items-center gap-2 border-t border-gold/30 bg-gold/5 px-4 py-2.5 text-sm text-gold hover:bg-gold/10"
        >
          ▲ Wacht op review —{" "}
          {u.state === "wacht-op-review-act2" ? "markeringen & JAS-klassen" : "begrippen & afleidingsregels"}
          <span className="ml-auto font-medium">Open review →</span>
        </Link>
      )}
      {isFout && (
        <div className="flex items-center gap-3 border-t border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
          <span className="min-w-0 truncate">
            ✕ {u.error?.bericht || "Analyse gestopt"}
            {u.error ? <span className="ml-1 font-mono text-xs opacity-70">({u.error.klasse})</span> : null}
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={bezig}
            className="ml-auto shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {bezig ? "Bezig…" : "Retry"}
          </button>
        </div>
      )}
    </Card>
  );
}
