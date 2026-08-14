"use client";

import { useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
import { Melding } from "@/components/ui/Melding";
import { DocumentPaneel } from "@/components/workbench/DocumentPaneel";
import { ReviewQueue } from "@/components/workbench/ReviewQueue";
import { SelectiePopover, type SelectieDoel } from "@/components/workbench/SelectiePopover";
import { DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_STYLE, overlaptSelectie } from "@/lib/annotatie";
import { jasStyle } from "@/lib/jas";
import { maakAnker, vindPositie } from "@/lib/selectie";
import type {
  AnnotatieDocument, AnnotatieElement, BeslissingInvoer, GraafArtikel, OntbrekendItem,
} from "@/lib/types";

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
  /** De jurist markeert zelf een fragment. Weglaten maakt het paneel alleen-lezen. */
  onEigenMarkering?: (invoer: {
    klasse: string; tekst: string; lid: string; toelichting: string;
    anker: ReturnType<typeof maakAnker>;
  }) => Promise<void>;
  /** Eigen markering wissen. Een agent-voorstel verwérp je — dat gaat via `onBeslissing`. */
  onWisEigenMarkering?: (elementId: string) => Promise<void>;
  /** Adviesvraag bij één element. Wijzigt nooit iets: de agent draait op de antwoord-route. */
  onAdvies?: (el: AnnotatieElement, vraag: string, opToken: (t: string) => void) => Promise<void>;
  onSluit: () => void;
}

/** Het annotatie-artefact: een van rechts inschuivend paneel (desktop) / bottom-sheet (mobiel) met de
 *  brongetrouwe artikeltekst (links, letterlijke highlights) en de review-queue (rechts). Los van de
 *  chatstroom, zoals een Claude-artefact. */
export function ArtefactPaneel({
  doc, info, ontbrekend, actiefId, onKies, onBeslissing, onEigenMarkering, onWisEigenMarkering,
  onAdvies, onSluit,
}: Props) {
  const opschrift = `${info.citeertitel || doc.bwbId} — artikel ${info.artikel}${doc.lid ? ` lid ${doc.lid}` : ""}`;
  const [selectie, setSelectie] = useState<(SelectieDoel & { start: number; eind: number; lid: string; bron: string }) | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  // Raakt de selectie de markering die in beeld staat? Dan is dit vermoedelijk een correctie op dát
  // element (inkorten/uitbreiden) en niet een nieuwe markering. De positie komt uit dezelfde
  // `vindPositie` als de weergave, dus het antwoord klopt altijd met wat je ziet.
  const actief = doc.elementen.find((e) => e.id === actiefId && e.lifecycle !== "rejected");
  const actiefBereik = (() => {
    if (!actief || !selectie) return null;
    const start = vindPositie(selectie.bron, actief.tekst.trim(), actief.anker, []);
    return start < 0 ? null : { start, eind: start + actief.tekst.trim().length };
  })();
  // Een selectie die exact het huidige fragment is, is geen correctie: dan zou "aanpassen" een lege
  // wijziging wegschrijven en het auditspoor vervuilen met een beslissing zonder inhoud.
  const teCorrigeren =
    actief && actiefBereik && selectie && selectie.fragment !== actief.tekst
    && overlaptSelectie(selectie, actiefBereik)
      ? actief
      : undefined;

  /** Het fragment van de actieve markering vervangen door de selectie. Het anker gaat mee: zonder
   *  dat wijzen de offsets naar het oude fragment en springt de markering na herladen. */
  async function pasFragmentAan() {
    if (!selectie || !teCorrigeren) return;
    setFout(null);
    try {
      await onBeslissing(teCorrigeren.id, {
        type: "edit",
        review_reason: "tekst",
        wijziging: {
          tekst: selectie.fragment,
          anker: maakAnker(selectie.bron, selectie.start, selectie.eind, selectie.lid),
        },
      });
      setSelectie(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Aanpassen is niet gelukt.");
    }
  }

  async function markeer(klasse: string, toelichting: string) {
    if (!selectie || !onEigenMarkering) return;
    setFout(null);
    try {
      await onEigenMarkering({
        klasse,
        tekst: selectie.fragment,
        lid: selectie.lid,
        toelichting,
        anker: maakAnker(selectie.bron, selectie.start, selectie.eind, selectie.lid),
      });
      setSelectie(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Markeren is niet gelukt.");
    }
  }

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
              .map((e) => ({
                id: e.id, klasse: e.klasse, tekst: e.tekst, herkomst: e.herkomst, anker: e.anker,
              }))}
            actiefId={actiefId}
            onKies={onKies}
            onSelectie={onEigenMarkering ? setSelectie : undefined}
          />
          {onEigenMarkering && (
            <p className="-mt-2 text-xs text-faint">
              Tip: selecteer een stuk tekst om het zelf te markeren — of klik eerst een markering aan
              en selecteer opnieuw om die in te korten of uit te breiden.
            </p>
          )}
          {fout && <Melding type="fout" compact>{fout}</Melding>}
          {doc.elementen.length > 0 ? (
            <ReviewQueue
              elementen={doc.elementen}
              actiefId={actiefId}
              onKies={onKies}
              onBeslissing={onBeslissing}
              onVerwijder={onWisEigenMarkering}
              onAdvies={onAdvies}
            />
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

        {selectie && (
          <SelectiePopover
            doel={selectie}
            aanpasbaar={teCorrigeren ? { klasse: teCorrigeren.klasse, tekst: teCorrigeren.tekst } : undefined}
            onPasAan={teCorrigeren ? pasFragmentAan : undefined}
            onKies={markeer}
            onSluit={() => setSelectie(null)}
          />
        )}
      </>
    </Dialog>
  );
}
