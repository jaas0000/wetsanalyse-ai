"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/werkplek/Markdown";

/** Vraag de assistent om uitleg bij één markering, zonder het artefact te verlaten.
 *
 *  Waarom hier en niet in de chat: het artefactpaneel is modaal, dus de chat is onbereikbaar zolang
 *  je aan het reviewen bent — precies het moment waarop de twijfel ontstaat. Het vraag/antwoord-paar
 *  wordt óók als gespreksbericht bewaard, zodat het gesprek één verhaal blijft.
 *
 *  Het antwoord wijzigt niets: de agent draait hier op de antwoord-route, die geen element-events
 *  uitstuurt. Dat is een topologische garantie, geen belofte in een prompt.
 */
export function AdviesDraadje({
  onVraag,
}: {
  onVraag: (vraag: string, opToken: (t: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [vraag, setVraag] = useState("");
  const [antwoord, setAntwoord] = useState("");
  const [bezig, setBezig] = useState(false);

  async function stel() {
    const v = vraag.trim();
    if (!v || bezig) return;
    setBezig(true);
    setAntwoord("");
    try {
      await onVraag(v, (t) => setAntwoord((a) => a + t));
    } catch (e) {
      setAntwoord(`⚠️ ${e instanceof Error ? e.message : "Vragen is niet gelukt."}`);
    } finally {
      setBezig(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          Vraag de assistent
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-kaart border border-line bg-surface p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1.5">
        <input
          autoFocus
          value={vraag}
          onChange={(e) => setVraag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void stel();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Waarom deze klasse? Wat zegt de wet hierover?"
          disabled={bezig}
          className="min-w-0 flex-1 rounded-kaart border border-line bg-paper px-2 py-1.5 text-xs text-ink placeholder-muted focus:border-lint focus:outline-none"
        />
        <Button size="sm" onClick={() => void stel()} disabled={bezig || !vraag.trim()}>
          {bezig ? "…" : "Vraag"}
        </Button>
      </div>

      {antwoord && (
        <div className="mt-2 border-l-2 border-lint/40 pl-2 text-xs text-ink">
          <Markdown tekst={antwoord} />
        </div>
      )}
      {!antwoord && !bezig && (
        <p className="mt-1.5 text-[0.65rem] text-faint">
          Het antwoord is advies: je annotatie verandert er niet door.
        </p>
      )}
    </div>
  );
}
