"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Selector voor de elementen die de Tab-trap als focusbaar telt. */
const FOCUSBAAR =
  'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])';

export type DialogVariant =
  /** Gecentreerd venster (instellingen). Op mobiel een bijna-volledig-scherm sheet. */
  | "center"
  /** Van rechts inschuivend paneel (artefact). Op mobiel een bottom-sheet. */
  | "side"
  /** Eigen kolom naast de inhoud (artefact op een breed scherm). NIET modaal. */
  | "kolom"
  /** Van links inschuivend paneel over de volle hoogte (de gesprekkenlijst op een smal scherm). */
  | "drawer";

const PANEEL_CLASS: Record<DialogVariant, string> = {
  center:
    "absolute inset-x-0 bottom-0 top-[6%] flex flex-col rounded-t-vorm bg-paper shadow-kaart outline-none animate-rise " +
    "sm:inset-0 sm:m-auto sm:h-[min(42rem,85vh)] sm:w-[min(56rem,92vw)] sm:rounded-vorm",
  side:
    "absolute inset-x-0 bottom-0 top-[8%] flex flex-col rounded-t-vorm bg-paper shadow-kaart outline-none animate-rise " +
    "sm:inset-y-0 sm:right-0 sm:left-auto sm:top-0 sm:w-[min(46rem,92vw)] sm:rounded-none sm:rounded-l-vorm",
  kolom: "flex h-full w-full flex-col border-l border-line bg-paper outline-none",
  // Geen `animate-rise` hier: die schuift 8px omhoog, en dat is de verkeerde richting voor een
  // paneel dat van links komt. Liever geen animatie dan een die de verkeerde kant op wijst.
  drawer: "absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-paper shadow-xl outline-none",
};

interface Props {
  /** Voorleesnaam van het venster (aria-label). */
  label: string;
  variant?: DialogVariant;
  /** Extra klassen op de buitenste laag (de backdrop-houder), bv. `lg:hidden` voor een drawer die
   *  alleen op smalle schermen bestaat. */
  wrapperClassName?: string;
  onSluit: () => void;
  /** Wat Escape doet, als dat niet simpelweg sluiten is.
   *
   *  Een venster met eigen lagen erin (een open bedieningsrij, een popover, een selectie) wil dat
   *  Escape éérst de bovenste laag afpelt. Dat kan het venster niet zelf: beide luisteraars hangen
   *  aan `window`, en deze staat er als eerste op — een `stopPropagation` van binnenuit komt te laat.
   *  Dus geeft de eigenaar zijn eigen afhandeling mee. Achtergrondklik blijft `onSluit`. */
  onEscape?: () => void;
  children: ReactNode;
}

/** Venster in drie vormen: gecentreerd (`center`), inschuivend (`side`) of als eigen kolom naast de
 *  inhoud (`kolom`).
 *
 *  Eén implementatie voor alle drie zodat er niet meerdere focus-traps naast elkaar leven die uit de
 *  pas kunnen lopen. De vormgeving komt uit de tokens (`bg-paper`, `shadow-kaart`, `rounded-vorm`);
 *  mobiel is het bij `center`/`side` een sheet met safe-area-respect.
 *
 *  **`kolom` is bewust niet modaal**: geen backdrop, geen `aria-modal`, en géén focus-trap. Het
 *  paneel staat dan náást de chat, en die moet juist bereikbaar blijven — een trap zou je erin
 *  opsluiten. Escape sluit wél, dat is in alle drie de vormen dezelfde uitweg. */
export function Dialog({ label, variant = "center", wrapperClassName = "", onSluit, onEscape, children }: Props) {
  const paneelRef = useRef<HTMLDivElement>(null);
  const modaal = variant !== "kolom";

  useEffect(() => {
    const opKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        (onEscape ?? onSluit)();
        return;
      }
      if (modaal && e.key === "Tab" && paneelRef.current) {
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
    return () => window.removeEventListener("keydown", opKey);
  }, [onSluit, onEscape, modaal]);

  // De focus verplaatsen hoort bij het ópenen, niet bij het (her)registreren van de luisteraar —
  // anders trekt elke wisseling van een callback de cursor terug naar het paneel, midden in het
  // veld waar je aan het typen was. Alleen modaal: bij de kolomvorm staat de chat er juist naast.
  useEffect(() => {
    if (modaal) paneelRef.current?.focus();
  }, [modaal]);

  if (!modaal) {
    return (
      <section
        ref={paneelRef}
        tabIndex={-1}
        aria-label={label}
        className={PANEEL_CLASS[variant]}
      >
        {children}
      </section>
    );
  }

  return (
    <div className={`fixed inset-0 z-40 ${wrapperClassName}`} role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-ink/30" onClick={onSluit} />
      <div ref={paneelRef} tabIndex={-1} className={PANEEL_CLASS[variant]}>
        {children}
      </div>
    </div>
  );
}
