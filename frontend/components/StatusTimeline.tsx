import type { Job, JobState } from "@/lib/types";

const STAPPEN: { key: string; label: string; states: JobState[] }[] = [
  { key: "act2", label: "Activiteit 2 — markeren & classificeren", states: ["act2-runt", "wacht-op-review-act2"] },
  { key: "act3", label: "Activiteit 3 — begrippen & afleidingsregels", states: ["act3-runt", "wacht-op-review-act3"] },
  { key: "bouwt", label: "Rapport samenstellen", states: ["bouwt"] },
  { key: "klaar", label: "Klaar", states: ["klaar"] },
];

const VOLGORDE: JobState[] = [
  "queued",
  "act2-runt",
  "wacht-op-review-act2",
  "act3-runt",
  "wacht-op-review-act3",
  "bouwt",
  "klaar",
];

function fase(state: JobState): number {
  const i = VOLGORDE.indexOf(state);
  return i < 0 ? 0 : i;
}

export function StatusTimeline({ job }: { job: Job }) {
  const huidige = fase(job.state);

  return (
    <ol className="space-y-3">
      {STAPPEN.map((stap) => {
        const stapFase = fase(stap.states[stap.states.length - 1]);
        const actief = stap.states.includes(job.state);
        const klaar = huidige > stapFase || job.state === "klaar";
        const isRunt = actief && stap.states.some((s) => s.endsWith("runt") || s === "bouwt");
        return (
          <li key={stap.key} className="flex items-center gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                klaar
                  ? "border-transparent bg-succes text-paper"
                  : actief
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line bg-paper text-faint"
              }`}
            >
              {klaar ? "✓" : isRunt ? <Spinner /> : "·"}
            </span>
            <span className={`text-sm ${actief ? "font-medium text-ink" : klaar ? "text-muted" : "text-faint"}`}>
              {stap.label}
              {actief && job.current_ronde > 0 && (
                <span className="ml-2 font-mono text-xs text-faint">ronde {job.current_ronde}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Spinner() {
  return (
    <span className="block h-3 w-3 animate-spin motion-reduce:animate-none rounded-full border-[1.5px] border-accent border-t-transparent motion-reduce:border-t-accent motion-reduce:opacity-60" />
  );
}
