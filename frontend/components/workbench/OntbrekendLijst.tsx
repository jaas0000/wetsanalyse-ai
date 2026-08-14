"use client";

import { useState } from "react";

import { jasStyle } from "@/lib/jas";
import { lidUitOffset, maakAnker, vindPositie } from "@/lib/selectie";
import type { AnnotatieElement, OntbrekendItem } from "@/lib/types";

/** Wat de Critic nog mist, als werkvoorraad in plaats van als mededeling.
 *
 *  De Critic levert deze lijst nadat de herzieningslus is uitgewerkt: het is dus wat de annoteerder
 *  níét heeft opgelost. Meestal omdat er geen letterlijk fragment bij stond — en zonder fragment kan
 *  niemand het toevoegen, want elk element moet letterlijk in de wettekst staan.
 *
 *  Staat het fragment er wél bij en is het terug te vinden, dan is toevoegen één klik: het wordt jouw
 *  markering (`human_approved`), met een anker op de plek waar het gevonden is.
 */
export function OntbrekendLijst({
  items,
  bron,
  leden,
  elementen,
  onToevoegen,
}: {
  items: OntbrekendItem[];
  /** De samengevoegde artikeltekst — hierin wordt het fragment opgezocht. */
  bron: string;
  leden: string[];
  /** Wat er al ligt, om te herkennen wat inmiddels is gemarkeerd. */
  elementen: AnnotatieElement[];
  onToevoegen?: (invoer: {
    klasse: string; tekst: string; lid: string; toelichting: string;
    anker: ReturnType<typeof maakAnker>;
  }) => Promise<void>;
}) {
  // Weggelegde items leven alleen in deze sessie: `ontbrekend` hoort bij het chatbericht, niet bij
  // het annotatiedocument, en er is geen veld om "afgehandeld" in vast te leggen. Na herladen staan
  // ze er dus weer — wat ook eerlijk is: ze zijn niet opgelost, alleen genegeerd.
  const [weggelegd, setWeggelegd] = useState<Set<number>>(new Set());
  const [bezig, setBezig] = useState<number | null>(null);

  const zichtbaar = items
    .map((item, i) => ({ item, i }))
    .filter(({ i }) => !weggelegd.has(i));
  if (zichtbaar.length === 0) return null;

  const genormaliseerd = (s: string) => s.split(/\s+/).join(" ").toLowerCase();
  const alGemarkeerd = new Set(elementen.map((e) => `${e.klasse}|${genormaliseerd(e.tekst)}`));

  return (
    <div className="rounded-kaart border border-dashed border-line bg-surface p-3">
      <p className="text-xs font-medium text-muted">
        Mogelijk ontbrekend — de assistent denkt dat dit er ook in zit ({zichtbaar.length})
      </p>

      <ul className="mt-2 space-y-2">
        {zichtbaar.map(({ item, i }) => {
          const fragment = (item.tekst ?? "").trim();
          const start = fragment ? vindPositie(bron, fragment, null, []) : -1;
          const klaar = fragment && alGemarkeerd.has(`${item.klasse}|${genormaliseerd(fragment)}`);
          const toevoegbaar = !!onToevoegen && start >= 0 && !klaar;

          return (
            <li key={i} className="rounded-kaart border border-line bg-paper p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${jasStyle(item.klasse)}`}>
                  {item.klasse}
                </span>
                {fragment ? (
                  <span className="min-w-0 flex-1 truncate text-xs italic text-ink">“{fragment}”</span>
                ) : (
                  <span className="min-w-0 flex-1 text-xs text-faint">geen fragment aangewezen</span>
                )}
              </div>

              {item.reden && <p className="mt-1 text-xs text-muted">{item.reden}</p>}

              {/* Drie situaties, drie boodschappen. Niets verzwijgen: kan het niet, zeg dan waarom. */}
              {fragment && start < 0 && (
                <p className="mt-1 text-xs text-aandacht-geel-tekst">
                  Dit fragment staat niet letterlijk in de opgehaalde tekst.
                </p>
              )}
              {!fragment && (
                <p className="mt-1 text-xs text-faint">
                  Selecteer het zelf in de tekst om het te markeren.
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {klaar ? (
                  <span className="text-xs text-succes">✓ inmiddels gemarkeerd</span>
                ) : (
                  toevoegbaar && (
                    <button
                      type="button"
                      disabled={bezig === i}
                      onClick={async () => {
                        setBezig(i);
                        try {
                          const lid = lidUitOffset(leden, start);
                          await onToevoegen!({
                            klasse: item.klasse,
                            tekst: fragment,
                            lid,
                            toelichting: "",
                            anker: maakAnker(bron, start, start + fragment.length, lid),
                          });
                        } finally {
                          setBezig(null);
                        }
                      }}
                      className="focus-ring inline-flex min-h-[24px] items-center rounded-lg bg-lint px-2.5 py-1 text-xs font-medium text-paper transition hover:bg-accent-soft coarse:min-h-[44px] disabled:opacity-50"
                    >
                      Toevoegen als {item.klasse}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setWeggelegd((s) => new Set(s).add(i))}
                  className="focus-ring inline-flex min-h-[24px] items-center rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:border-lint hover:text-ink coarse:min-h-[44px]"
                >
                  Wegleggen
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
