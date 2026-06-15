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

// Badge-stijl per state (Tailwind), afgestemd op de Rijkshuisstijl: lopend = lintblauw,
// review = aandacht-oranje, klaar = succes-groen, fout = rood. Tekst voldoet aan ≥ 4,5:1.
export const STATE_STYLE: Record<JobState, string> = {
  queued: "bg-surface text-muted border-line",
  "act2-runt": "bg-[#e7eef5] text-[#154273] border-[#bcd2e6]",
  "wacht-op-review-act2": "bg-[#fbefe2] text-[#8e4600] border-[#e7c9a8]",
  "act3-runt": "bg-[#e7eef5] text-[#154273] border-[#bcd2e6]",
  "wacht-op-review-act3": "bg-[#fbefe2] text-[#8e4600] border-[#e7c9a8]",
  bouwt: "bg-[#ece9f2] text-[#473a5e] border-[#d2c8dd]",
  klaar: "bg-[#e6f0e0] text-[#2c6608] border-[#bcd9a8]",
  fout: "bg-[#fbe7e5] text-[#b01b10] border-[#f0bcb6]",
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
