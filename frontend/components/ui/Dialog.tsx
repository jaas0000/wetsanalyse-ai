"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Selector voor de elementen die de Tab-trap als focusbaar telt. */
const FOCUSBAAR =
  'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export type DialogVariant =
  /** Gecentreerd venster (instellingen). Op mobiel een bijna-volledig-scherm sheet. */
  | "center"
  /** Van rechts inschuivend paneel (artefact). Op mobiel een bottom-sheet. */
  | "side";

const PANEEL_CLASS: Record<DialogVariant, string> = {
  center:
    "absolute inset-x-0 bottom-0 top-[6%] flex flex-col rounded-t-vorm bg-paper shadow-kaart outline-none animate-rise " +
    "sm:inset-0 sm:m-auto sm:h-[min(42rem,85vh)] sm:w-[min(56rem,92vw)] sm:rounded-vorm",
  side:
    "absolute inset-x-0 bottom-0 top-[8%] flex flex-col rounded-t-vorm bg-paper shadow-kaart outline-none animate-rise " +
    "sm:inset-y-0 sm:right-0 sm:left-auto sm:top-0 sm:w-[min(46rem,92vw)] sm:rounded-none sm:rounded-l-vorm",
};

interface Props {
  /** Voorleesnaam van het venster (aria-label). */
  label: string;
  variant?: DialogVariant;
  onSluit: () => void;
  children: ReactNode;
}

/** Modaal venster: backdrop die op klik sluit, Escape sluit, en de focus blijft binnen het paneel.
 *
 *  Eén implementatie voor beide vormen die de werkplek gebruikt — het artefact-paneel (`side`) en de
 *  instellingen (`center`) — zodat er niet twee focus-traps naast elkaar leven die uit de pas kunnen
 *  lopen. De vormgeving komt uit de tokens (`bg-paper`, `shadow-kaart`, `rounded-vorm`); mobiel is
 *  het in beide gevallen een sheet met safe-area-respect. */
export function Dialog({ label, variant = "center", onSluit, children }: Props) {
  const paneelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSluit();
        return;
      }
      if (e.key === "Tab" && paneelRef.current) {
        const f = paneelRef.current.querySelectorAll<HTMLElement>(FOCUSBAAR);
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        const actief = document.activeElement;
        if (e.shiftKey && (actief === first || actief === paneelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && actief === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", opKey);
    paneelRef.current?.focus();
    return () => window.removeEventListener("keydown", opKey);
  }, [onSluit]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-ink/30" onClick={onSluit} />
      <div ref={paneelRef} tabIndex={-1} className={PANEEL_CLASS[variant]}>
        {children}
      </div>
    </div>
  );
}
