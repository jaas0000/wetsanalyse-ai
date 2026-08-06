"use client";

import { useEffect, useRef } from "react";

import { DocumentPaneel } from "@/components/workbench/DocumentPaneel";
import { ReviewQueue } from "@/components/workbench/ReviewQueue";
import { DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_STYLE } from "@/lib/annotatie";
import { jasStyle } from "@/lib/jas";
import type { AnnotatieDocument, BeslissingInvoer, GraafArtikel, OntbrekendItem } from "@/lib/types";

function ledenVan(info: GraafArtikel): string[] {
  return info.leden_teksten.map((l) => (l.lid ? `${l.lid}. ${l.tekst}` : l.tekst)).filter(Boolean);
}

interface Props {
  doc: AnnotatieDocument;
  info: GraafArtikel;
  ontbrekend?: OntbrekendItem[];
  actiefId?: string;
  onKies: (id?: string) => void;
  onBeslissing: (elementId: string, req: BeslissingInvoer) => Promise<void>;
  onSluit: () => void;
}

/** Het annotatie-artefact: een van rechts inschuivend paneel (desktop) / bottom-sheet (mobiel) met de
 *  brongetrouwe artikeltekst (links, letterlijke highlights) en de review-queue (rechts). Los van de
 *  chatstroom, zoals een Claude-artefact. */
export function ArtefactPaneel({ doc, info, ontbrekend, actiefId, onKies, onBeslissing, onSluit }: Props) {
  const paneelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSluit();
        return;
      }
      // Focus binnen het paneel houden (Tab-trap).
      if (e.key === "Tab" && paneelRef.current) {
        const f = paneelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        );
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

  const opschrift = `${info.citeertitel || doc.bwbId} — artikel ${info.artikel}${doc.lid ? ` lid ${doc.lid}` : ""}`;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`Annotatie: ${opschrift}`}>
      <div className="absolute inset-0 bg-ink/30" onClick={onSluit} />
      {/* Desktop: rechter-paneel; mobiel: bottom-sheet (bijna volledig scherm). */}
      <div
        ref={paneelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 top-[8%] flex flex-col rounded-t-vorm bg-paper shadow-kaart outline-none animate-rise sm:inset-y-0 sm:right-0 sm:left-auto sm:top-0 sm:w-[min(46rem,92vw)] sm:rounded-none sm:rounded-l-vorm"
      >
        {/* Kop */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-faint">Annotatie · JAS</p>
            <h2 className="truncate font-display text-base font-semibold text-lint">{opschrift}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${DOCUMENT_STATUS_STYLE[doc.status]}`}>
              {DOCUMENT_STATUS_LABEL[doc.status]}
            </span>
            <button
              type="button"
              onClick={onSluit}
              aria-label="Sluiten"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Inhoud: op mobiel gestapeld (tekst → review), op desktop dezelfde volgorde in één scroller */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DocumentPaneel
            opschrift=""
            leden={ledenVan(info)}
            elementen={doc.elementen.map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst }))}
            actiefId={actiefId}
            onKies={onKies}
          />
          {doc.elementen.length > 0 ? (
            <ReviewQueue elementen={doc.elementen} actiefId={actiefId} onKies={onKies} onBeslissing={onBeslissing} />
          ) : (
            <p className="text-sm text-muted">Geen elementen.</p>
          )}
          {ontbrekend && ontbrekend.length > 0 && (
            <div className="rounded-kaart border border-dashed border-line bg-surface p-3">
              <p className="text-xs font-medium text-muted">Mogelijk ontbrekend (Critic-suggestie)</p>
              <ul className="mt-1.5 space-y-1">
                {ontbrekend.map((o, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${jasStyle(o.klasse)}`}>{o.klasse}</span>
                    {o.reden && <span className="text-muted">{o.reden}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
