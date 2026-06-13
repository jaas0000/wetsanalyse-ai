"use client";

import { useEffect, useState } from "react";
import { LinkButton } from "@/components/ui/Button";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Desktop: nav inline */}
      <nav className="hidden shrink-0 items-center gap-2 sm:flex">
        <LinkButton href="/" variant="ghost">
          Projecten
        </LinkButton>
        <LinkButton href="/nieuw">Nieuwe analyse</LinkButton>
      </nav>

      {/* Mobiel: hamburger-toggle */}
      <button
        type="button"
        aria-label={open ? "Menu sluiten" : "Menu openen"}
        aria-expanded={open}
        aria-controls="mobiel-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-line p-2 text-ink transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Mobiel: uitklappaneel onder de header */}
      {open && (
        <div
          id="mobiel-menu"
          onClick={() => setOpen(false)}
          className="absolute inset-x-0 top-full z-20 flex flex-col gap-2 border-b border-line bg-surface px-6 py-4 shadow-sm sm:hidden"
        >
          <LinkButton href="/" variant="ghost" className="w-full">
            Projecten
          </LinkButton>
          <LinkButton href="/nieuw" className="w-full">
            Nieuwe analyse
          </LinkButton>
        </div>
      )}
    </>
  );
}
