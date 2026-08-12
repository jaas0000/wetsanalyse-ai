"use client";

import { Dialog } from "@/components/ui/Dialog";
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
  const opschrift = `${info.citeertitel || doc.bwbId} — artikel ${info.artikel}${doc.lid ? ` lid ${doc.lid}` : ""}`;

  return (
    <Dialog label={`Annotatie: ${opschrift}`} variant="side" onSluit={onSluit}>
      <>
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
            // Verworpen markeringen niet in de tekst oplichten (de reviewer keurde ze net af); ze
            // blijven wél in de ReviewQueue zichtbaar met hun "verworpen"-status.
            elementen={doc.elementen
              .filter((e) => e.lifecycle !== "rejected")
              .map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst }))}
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
      </>
    </Dialog>
  );
}
