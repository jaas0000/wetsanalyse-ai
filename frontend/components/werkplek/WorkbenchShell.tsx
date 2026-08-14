"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
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
  const [laden, setLaden] = useState(true); // eerste gesprekken-fetch loopt nog → sidebar-skeletons
  // Een mislukte hernoem- of verwijderactie mag de werkplek niet blokkeren, maar hoort ook niet stil
  // te blijven: zonder melding is "de nieuwe naam staat er niet" niet te onderscheiden van "de naam
  // is niet aangeslagen", en blijft een gesprek na een bevestigde verwijdering gewoon staan.
  const [fout, setFout] = useState<string | null>(null);

  const verversLijst = useCallback(() => {
    lijstGesprekken()
      .then(setGesprekken)
      .catch(() => {})
      .finally(() => setLaden(false));
  }, []);

  useEffect(() => {
    verversLijst();
  }, [verversLijst]);

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
    setFout(null);
    try {
      await hernoemGesprek(id, titel);
      verversLijst();
    } catch {
      setFout("De nieuwe naam is niet opgeslagen.");
    }
  }

  async function verwijder(id: string) {
    if (!window.confirm("Dit gesprek verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    setFout(null);
    try {
      await verwijderGesprek(id);
      if (id === activeId) nieuwGesprek();
      else verversLijst();
    } catch {
      setFout("Het gesprek is niet verwijderd.");
    }
  }

  const actieveTitel = gesprekken.find((g) => g.id === activeId)?.titel || "Nieuw gesprek";

  return (
    <div className="flex h-full flex-col">
      {/* Waar zit ik? Deze strook hing eerder aan de globale sitekop, en die verborg zichzelf op de
          werkplek — dus juist waar je de hele dag werkt, zag je hem nooit. Nu staat hij bovenaan de
          schil. De klik opent de voorwaarden als dialog (intercepting route), zodat je je gesprek
          niet verlaat. */}
      <Link
        href="/disclaimer"
        className="focus-ring block shrink-0 bg-waarschuwing/10 py-1 text-center text-[0.7rem] text-ink transition-colors hover:bg-waarschuwing/20"
      >
        <span className="font-semibold">Testomgeving — proof of concept.</span>{" "}
        Analyses kunnen verloren gaan. <span className="underline">Lees de voorwaarden</span>
      </Link>

      {fout && (
        <div role="status" className="shrink-0 border-b border-fout/30 bg-fout/10 px-4 py-2 text-center text-[0.8125rem] text-fout">
          {fout}{" "}
          <button
            type="button"
            onClick={() => setFout(null)}
            className="focus-ring rounded font-medium underline underline-offset-2"
          >
            Sluiten
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
      {/* Desktop-sidebar */}
      <aside className="hidden w-[17rem] shrink-0 border-r border-line lg:block">
        <GesprekSidebar
          gesprekken={gesprekken}
          activeId={activeId}
          onNieuw={nieuwGesprek}
          onOpen={openGesprek}
          onHernoem={hernoem}
          onVerwijder={verwijder}
          laden={laden}
        />
      </aside>

      {/* Mobiele off-canvas drawer. Via `Dialog` en niet als eigen constructie: die draagt de
          focus-trap, Escape en de backdrop. Deze drawer had wél `role="dialog"` en `aria-modal` maar
          geen van de mechanismen erachter, dus liep Tab achter de scrim door naar de chat eronder. */}
      {drawerOpen && (
        <Dialog
          label="Gesprekken"
          variant="drawer"
          wrapperClassName="lg:hidden"
          onSluit={() => setDrawerOpen(false)}
        >
          <GesprekSidebar
            gesprekken={gesprekken}
            activeId={activeId}
            onNieuw={nieuwGesprek}
            onOpen={openGesprek}
            onHernoem={hernoem}
            onVerwijder={verwijder}
            laden={laden}
            onSluit={() => setDrawerOpen(false)}
          />
        </Dialog>
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
    </div>
  );
}
