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

/** Bepaal niet-overlappende markeringen in `bron`.
 *
 *  Volgorde bepaalt wie bij overlap wint, en die volgorde is een inhoudelijke keuze:
 *   1. **de jurist vóór de agent** — dezelfde regel als server-side, waar een mens-element bevroren
 *      is. Wat jij zelf markeerde blijft staan; een agent-voorstel wijkt uit naar een ander
 *      voorkomen of verdwijnt uit de tekst (het blijft wél in de reviewlijst staan).
 *   2. **langste fragment eerst**, zodat een lange markering niet door een kort deelfragment wordt
 *      opgebroken.
 *
 *  De positie komt uit `vindPositie`: eerst het anker (exacte offsets), dan de omringende tekst,
 *  dan het eerste vrije voorkomen. Zo blijven twee identieke fragmenten in één artikel uit elkaar. */
export function segmenteer(bron: string, elementen: Markeerbaar[]): Segment[] {
  const bezet: { start: number; eind: number; klasse: string; id?: string; herkomst?: string }[] = [];
  const gesorteerd = [...elementen].sort((a, b) => {
    const mensA = a.herkomst === "mens" ? 0 : 1;
    const mensB = b.herkomst === "mens" ? 0 : 1;
    return mensA !== mensB ? mensA - mensB : b.tekst.length - a.tekst.length;
  });
  for (const el of gesorteerd) {
    const fragment = el.tekst.trim();
    if (!fragment) continue;
    const idx = vindPositie(bron, fragment, el.anker, bezet);
    if (idx < 0) continue;
    bezet.push({
      start: idx, eind: idx + fragment.length,
      klasse: el.klasse, id: el.id, herkomst: el.herkomst,
    });
  }
  bezet.sort((a, b) => a.start - b.start);

  const segmenten: Segment[] = [];
  let pos = 0;
  for (const b of bezet) {
    if (b.start > pos) segmenten.push({ tekst: bron.slice(pos, b.start) });
    segmenten.push({
      tekst: bron.slice(b.start, b.eind), klasse: b.klasse, id: b.id, herkomst: b.herkomst,
    });
    pos = b.eind;
  }
  if (pos < bron.length) segmenten.push({ tekst: bron.slice(pos) });
  return segmenten;
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
  const segmenten = useMemo(() => segmenteer(bron, elementen), [bron, elementen]);
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
