"use client";

import { useMemo, useRef } from "react";

import { jasStyle } from "@/lib/jas";
import { lidUitOffset, offsetUit, snapSelectie, vindPositie } from "@/lib/selectie";
import type { Anker } from "@/lib/types";

/** Minimaal element voor highlighting: klasse + letterlijk fragment (+ optioneel id/anker/herkomst). */
export interface Markeerbaar {
  id?: string;
  klasse: string;
  tekst: string;
  herkomst?: string;
  anker?: Anker | null;
}

interface Segment {
  tekst: string;
  klasse?: string;
  id?: string;
  herkomst?: string;
}

/** Knip `bron` in segmenten, met hoogstens ÉÉN gemarkeerd: de geselecteerde.
 *
 *  Alles tegelijk kleuren was onleesbaar én onvolledig. Twee markeringen kunnen niet op dezelfde
 *  tekst liggen, dus een markering die binnen een langere valt — een Rechtsobject in een zin die als
 *  geheel een Afleidingsregel is — verdween gewoon uit beeld. Nu is de reviewlijst de ingang en laat
 *  de tekst zien wáár het gekozen element staat; zonder selectie blijft de tekst schoon.
 *
 *  De positie komt uit `vindPositie`: eerst het anker (exacte offsets), dan de omringende tekst, dan
 *  het eerste voorkomen. Dat houdt twee identieke fragmenten in één artikel uit elkaar — zonder
 *  anker zou de tweede "De ontvanger" op de eerste landen.
 */
export function segmenteer(bron: string, elementen: Markeerbaar[], actiefId?: string): Segment[] {
  const el = actiefId ? elementen.find((e) => e.id === actiefId) : undefined;
  const fragment = el?.tekst.trim() ?? "";
  const start = fragment ? vindPositie(bron, fragment, el?.anker, []) : -1;
  if (!el || start < 0) return [{ tekst: bron }];

  const eind = start + fragment.length;
  return [
    ...(start > 0 ? [{ tekst: bron.slice(0, start) }] : []),
    { tekst: bron.slice(start, eind), klasse: el.klasse, id: el.id, herkomst: el.herkomst },
    ...(eind < bron.length ? [{ tekst: bron.slice(eind) }] : []),
  ];
}

export function DocumentPaneel({
  opschrift,
  leden,
  elementen,
  actiefId,
  onKies,
  onSelectie,
}: {
  opschrift: string;
  leden: string[];
  elementen: Markeerbaar[];
  actiefId?: string;
  onKies?: (id?: string) => void;
  /** De jurist heeft tekst geselecteerd om zelf te markeren. Weglaten = alleen-lezen. */
  onSelectie?: (sel: { fragment: string; start: number; eind: number; lid: string; bron: string; x: number; y: number }) => void;
}) {
  const bron = useMemo(() => leden.join("\n\n"), [leden]);
  const segmenten = useMemo(() => segmenteer(bron, elementen, actiefId), [bron, elementen, actiefId]);
  const gekozen = actiefId ? elementen.find((e) => e.id === actiefId) : undefined;
  const tekstRef = useRef<HTMLParagraphElement>(null);

  /** Zet een DOM-selectie om naar offsets in `bron`.
   *
   *  Dit kan omdat de alinea één aaneengesloten reeks span/mark is waarvan de tekstknopen samen
   *  exact `bron` vormen — dus de lengtes optellen tot de startknoop geeft de absolute positie.
   *  De rekenstap zelf staat in `lib/selectie.ts` en is daar getest; hier blijft alleen de
   *  DOM-wandeling over, die in de node-omgeving van vitest toch niet te testen is. */
  function verwerkSelectie() {
    if (!onSelectie) return;
    const sel = window.getSelection();
    const houder = tekstRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !houder) return;
    const range = sel.getRangeAt(0);
    if (!houder.contains(range.commonAncestorContainer)) return;

    const knopen: Text[] = [];
    const walker = document.createTreeWalker(houder, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) knopen.push(n as Text);

    const lengtes = knopen.map((n) => n.data.length);
    const vanIdx = knopen.indexOf(range.startContainer as Text);
    const totIdx = knopen.indexOf(range.endContainer as Text);
    if (vanIdx < 0 || totIdx < 0) return;

    const ruwStart = offsetUit(lengtes, vanIdx, range.startOffset);
    const ruwEind = offsetUit(lengtes, totIdx, range.endOffset);
    const { start, eind } = snapSelectie(bron, ruwStart, ruwEind);
    if (eind - start < 2) return;   // losse letter of alleen witruimte: geen markering

    const rect = range.getBoundingClientRect();
    onSelectie({
      fragment: bron.slice(start, eind),
      start,
      eind,
      lid: lidUitOffset(leden, start),
      bron,
      x: rect.left + rect.width / 2,
      y: rect.bottom,
    });
  }

  return (
    <div className="rounded-kaart border border-line bg-white p-5 shadow-zacht">
      {opschrift && <h2 className="mb-3 font-display text-lg font-semibold text-lint">{opschrift}</h2>}
      {elementen.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-kaart bg-lint/5 px-3 py-2 text-xs text-muted">
          {gekozen ? (
            <>
              <span>
                <span className="font-medium text-ink">{gekozen.klasse}</span> in beeld
              </span>
              <button
                type="button"
                onClick={() => onKies?.(undefined)}
                className="shrink-0 font-medium text-lint underline underline-offset-2 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
              >
                Verbergen
              </button>
            </>
          ) : (
            <span>
              Kies een markering in de lijst om te zien waar hij staat, of selecteer tekst om zelf te
              markeren.
            </span>
          )}
        </div>
      )}
      <p
        ref={tekstRef}
        onMouseUp={verwerkSelectie}
        className="whitespace-pre-wrap text-[0.95rem] leading-7 text-ink"
      >
        {segmenten.map((s, i) =>
          s.klasse ? (
            <mark
              key={i}
              onClick={() => onKies?.(s.id)}
              title={s.herkomst === "mens" ? `${s.klasse} — door jou gemarkeerd` : s.klasse}
              className={`cursor-pointer rounded px-0.5 ${jasStyle(s.klasse)} ${
                s.herkomst === "mens" ? "underline decoration-dotted underline-offset-2" : ""
              } ${actiefId && s.id === actiefId ? "ring-2 ring-lint" : ""}`}
            >
              {s.tekst}
            </mark>
          ) : (
            <span key={i}>{s.tekst}</span>
          ),
        )}
      </p>
    </div>
  );
}
