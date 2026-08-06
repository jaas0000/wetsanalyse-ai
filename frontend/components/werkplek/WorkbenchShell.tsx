"use client";

import { useCallback, useEffect, useState } from "react";

import { GesprekSidebar } from "@/components/werkplek/GesprekSidebar";
import { WerkplekClient } from "@/components/werkplek/WerkplekClient";
import { hernoemGesprek, lijstGesprekken, verwijderGesprek } from "@/lib/api";
import type { GesprekSamenvatting } from "@/lib/types";

/** De volledige werkplek-app: links de sidebar (logo → chatgeschiedenis → instellingen/gebruiker),
 *  rechts het chatvenster. `activeId` stuurt de highlight; `mountKey` bepaalt wanneer het chatvenster
 *  vers remount (nieuw/openen) — een gesprek dat tijdens een lopende beurt een id krijgt, remount NIET
 *  (anders breekt de SSE-stream). Op mobiel wordt de sidebar een off-canvas drawer. */
export function WorkbenchShell() {
  const [gesprekken, setGesprekken] = useState<GesprekSamenvatting[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const verversLijst = useCallback(() => {
    lijstGesprekken().then(setGesprekken).catch(() => {});
  }, []);

  useEffect(() => {
    verversLijst();
  }, [verversLijst]);

  // Escape sluit de mobiele drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const opEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", opEsc);
    return () => window.removeEventListener("keydown", opEsc);
  }, [drawerOpen]);

  function nieuwGesprek() {
    setActiveId(null);
    setMountKey((k) => k + 1);
    setDrawerOpen(false);
  }

  function openGesprek(id: string) {
    setActiveId(id);
    setMountKey((k) => k + 1);
    setDrawerOpen(false);
  }

  // Het chatvenster maakte zojuist (bij de eerste beurt) een gesprek aan → highlight bijwerken zónder
  // remount, en de lijst verversen zodat het bovenaan verschijnt.
  function gesprekAangemaakt(id: string) {
    setActiveId(id);
    verversLijst();
  }

  async function hernoem(id: string, titel: string) {
    try {
      await hernoemGesprek(id, titel);
      verversLijst();
    } catch {
      /* stil */
    }
  }

  async function verwijder(id: string) {
    if (!window.confirm("Dit gesprek verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    try {
      await verwijderGesprek(id);
      if (id === activeId) nieuwGesprek();
      else verversLijst();
    } catch {
      /* stil */
    }
  }

  const actieveTitel = gesprekken.find((g) => g.id === activeId)?.titel || "Nieuw gesprek";

  return (
    <div className="flex h-full">
      {/* Desktop-sidebar */}
      <aside className="hidden w-[17rem] shrink-0 border-r border-line lg:block">
        <GesprekSidebar
          gesprekken={gesprekken}
          activeId={activeId}
          onNieuw={nieuwGesprek}
          onOpen={openGesprek}
          onHernoem={hernoem}
          onVerwijder={verwijder}
        />
      </aside>

      {/* Mobiele off-canvas drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Gesprekken">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs shadow-xl">
            <GesprekSidebar
              gesprekken={gesprekken}
              activeId={activeId}
              onNieuw={nieuwGesprek}
              onOpen={openGesprek}
              onHernoem={hernoem}
              onVerwijder={verwijder}
              onSluit={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Rechterkolom: mobiele topbar + chatvenster */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Gesprekken openen"
            className="inline-flex items-center justify-center rounded-lg border border-line p-2 text-lint transition-colors hover:bg-surface"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-lint">{actieveTitel}</span>
          <button
            type="button"
            onClick={nieuwGesprek}
            aria-label="Nieuw gesprek"
            className="inline-flex items-center justify-center rounded-lg border border-line p-2 text-lint transition-colors hover:bg-surface"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        <WerkplekClient
          key={mountKey}
          initialGesprekId={activeId}
          onGesprekAangemaakt={gesprekAangemaakt}
          onGewijzigd={verversLijst}
        />
      </div>
    </div>
  );
}
