import type { JobState } from "./types";

export const STATE_LABEL: Record<JobState, string> = {
  queued: "In wachtrij",
  "act2-runt": "Activiteit 2 — markeren",
  "wacht-op-review-act2": "Wacht op review (act. 2)",
  "act3-runt": "Activiteit 3 — begrippen",
  "wacht-op-review-act3": "Wacht op review (act. 3)",
  bouwt: "Rapport samenstellen",
  klaar: "Klaar",
  fout: "Fout",
};

// Badge-stijl per state (Tailwind). Gedempt, met semantische lading.
export const STATE_STYLE: Record<JobState, string> = {
  queued: "bg-faint text-muted border-line",
  "act2-runt": "bg-[#e6edf0] text-[#2f4a5a] border-[#c0d2dc]",
  "wacht-op-review-act2": "bg-[#f3ecdc] text-[#6b531f] border-[#e0cfa0]",
  "act3-runt": "bg-[#e6edf0] text-[#2f4a5a] border-[#c0d2dc]",
  "wacht-op-review-act3": "bg-[#f3ecdc] text-[#6b531f] border-[#e0cfa0]",
  bouwt: "bg-[#eae6f0] text-[#473a5e] border-[#cdc2dd]",
  klaar: "bg-[#e3eee3] text-[#2f5230] border-[#bcd9bc]",
  fout: "bg-[#f7e6e6] text-[#a01b1b] border-[#e3bcbc]",
};

export const RUNNING_STATES: JobState[] = ["queued", "act2-runt", "act3-runt", "bouwt"];
export const REVIEW_STATES: JobState[] = ["wacht-op-review-act2", "wacht-op-review-act3"];
export const TERMINAL_STATES: JobState[] = ["klaar", "fout"];

export function isReview(state: JobState): boolean {
  return REVIEW_STATES.includes(state);
}
export function isRunning(state: JobState): boolean {
  return RUNNING_STATES.includes(state);
}
export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Welke activiteit hoort bij een review-state? */
export function reviewActiviteit(state: JobState): "2" | "3" | null {
  if (state === "wacht-op-review-act2") return "2";
  if (state === "wacht-op-review-act3") return "3";
  return null;
}
