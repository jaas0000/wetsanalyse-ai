"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { JAS_KLASSEN, jasStyle } from "@/lib/jas";

/** Waar de popover moet verschijnen: het scherm-rechthoekje van de selectie. */
export interface SelectieDoel {
  fragment: string;
  x: number;
  y: number;
}

/** Keuzemenu bij een tekstselectie: kies een JAS-klasse en de markering is er.
 *
 *  Bewust géén hergebruik van `components/ui/Popover`: die ankert aan een wrapper-element, terwijl
 *  dit aan een muispositie hangt. Escape/klik-buiten volgen wel hetzelfde patroon.
 *
 *  De markering krijgt meteen `human_approved` — je eigen keuze hoef je niet nog eens goed te
 *  keuren — dus hier staat de klasse vast. Vandaar de volle lijst zonder voorsortering: een
 *  "meest waarschijnlijke" bovenaan zou een suggestie zijn die op dit moment niet hoort. */
export function SelectiePopover({
  doel,
  onKies,
  onVraagAssistent,
  onSluit,
}: {
  doel: SelectieDoel;
  onKies: (klasse: string, toelichting: string) => void | Promise<void>;
  onVraagAssistent?: (fragment: string) => void;
  onSluit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [toelichting, setToelichting] = useState("");
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    const opKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSluit();
    };
    const opKlik = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onSluit();
    };
    window.addEventListener("keydown", opKey);
    // Pas ná de huidige klik luisteren, anders sluit de popover meteen weer op de mouseup die hem
    // opende.
    const id = window.setTimeout(() => window.addEventListener("mousedown", opKlik), 0);
    return () => {
      window.removeEventListener("keydown", opKey);
      window.removeEventListener("mousedown", opKlik);
      window.clearTimeout(id);
    };
  }, [onSluit]);

  async function kies(klasse: string) {
    setBezig(true);
    try {
      await onKies(klasse, toelichting.trim());
    } finally {
      setBezig(false);
    }
  }

  // Binnen beeld houden: de popover is 20rem breed en verschijnt onder de selectie.
  const breedte = 320;
  const links = Math.max(
    8,
    Math.min(doel.x - breedte / 2, (globalThis.innerWidth || 1024) - breedte - 8),
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Markering toevoegen"
      style={{ position: "fixed", top: doel.y + 8, left: links, width: breedte }}
      className="z-50 rounded-kaart border border-line bg-paper p-3 shadow-kaart"
    >
      <p className="mb-2 line-clamp-2 text-xs text-muted">
        <span className="font-medium text-ink">Markeren:</span> “{doel.fragment}”
      </p>

      <div className="mb-2 flex flex-wrap gap-1">
        {JAS_KLASSEN.map((k) => (
          <button
            key={k}
            type="button"
            disabled={bezig}
            onClick={() => void kies(k)}
            className={`min-h-[28px] rounded-full border px-2 py-0.5 text-xs transition-opacity coarse:min-h-[36px] disabled:opacity-50 ${jasStyle(k)}`}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        value={toelichting}
        onChange={(e) => setToelichting(e.target.value)}
        placeholder="Toelichting (optioneel)"
        disabled={bezig}
        className="mb-2 w-full rounded-kaart border border-line bg-paper px-2 py-1.5 text-xs text-ink placeholder-muted focus:border-lint focus:outline-none"
      />

      <div className="flex items-center justify-between">
        {onVraagAssistent ? (
          <Button size="sm" variant="ghost" disabled={bezig} onClick={() => onVraagAssistent(doel.fragment)}>
            Vraag de assistent
          </Button>
        ) : (
          <span />
        )}
        <Button size="sm" variant="ghost" onClick={onSluit} disabled={bezig}>
          Annuleren
        </Button>
      </div>
    </div>
  );
}
