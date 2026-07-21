"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Melding } from "@/components/ui/Melding";
import { annoteerIntent, haalArtikelGraaf, isApiError } from "@/lib/api";
import type { GraafArtikel, IntentBegrepen, IntentResultaat, WetChoice } from "@/lib/types";

function foutTekst(e: unknown): string {
  if (isApiError(e)) return e.detail;
  return (e as Error)?.message ?? "Er ging iets mis.";
}

function preview(graaf: GraafArtikel): string {
  const tekst = graaf.leden_teksten
    .map((l) => (l.lid ? `${l.lid}. ${l.tekst}` : l.tekst))
    .join(" ");
  return tekst.length > 260 ? `${tekst.slice(0, 260)}…` : tekst;
}

/** Conversationele ingang: vraag de agent een artikel te annoteren; hij haalt de tekst uit de graaf
 *  en toont een bevestiging. Pas na "Start" (approve) draait de annotatie. */
export function AgentIngang({
  wetten,
  onStart,
  disabled,
}: {
  wetten: WetChoice[];
  onStart: (doel: IntentBegrepen, graaf: GraafArtikel) => void;
  disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [bezig, setBezig] = useState(false);
  const [intent, setIntent] = useState<IntentResultaat | null>(null);
  const [graaf, setGraaf] = useState<GraafArtikel | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  function reset() {
    setIntent(null);
    setGraaf(null);
  }

  async function vraag() {
    if (!prompt.trim()) return;
    setFout(null);
    setBezig(true);
    reset();
    try {
      const res = await annoteerIntent(prompt.trim(), wetten);
      if (res.begrepen) {
        const a = await haalArtikelGraaf(res.begrepen.bwbId, res.begrepen.artikel);
        if (!a.leden_teksten.length) {
          setIntent({
            begrepen: null,
            bevestiging: "",
            vraag: `Dit artikel staat (nog) niet in de graaf: ${res.begrepen.wetnaam || res.begrepen.bwbId} artikel ${res.begrepen.artikel}.`,
          });
        } else {
          setIntent(res);
          setGraaf(a);
        }
      } else {
        setIntent(res);
      }
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  function start() {
    if (intent?.begrepen && graaf) {
      onStart(intent.begrepen, graaf);
      setPrompt("");
      reset();
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-ink">Vraag de agent</span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !bezig) vraag();
            }}
            placeholder="bijv. annoteer artikel 9 lid 1 van de Invorderingswet 1990"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            disabled={disabled || bezig}
          />
          <Button onClick={vraag} disabled={disabled || bezig || !prompt.trim()} className="w-full sm:w-auto">
            {bezig ? "Bezig…" : "Vraag"}
          </Button>
        </div>
      </label>

      {fout && <div className="mt-3"><Melding type="fout">{fout}</Melding></div>}

      {/* Verduidelijkingsvraag van de agent */}
      {intent && !intent.begrepen && intent.vraag && (
        <div className="mt-3">
          <Melding type="uitleg">{intent.vraag}</Melding>
        </div>
      )}

      {/* Bevestigingskaart: approve/reject vóór het annoteren */}
      {intent?.begrepen && graaf && (
        <div className="mt-3 rounded-xl border border-lint/40 bg-surface p-3">
          <p className="text-sm font-medium text-ink">{intent.bevestiging}</p>
          <p className="mt-1 text-xs text-muted">{preview(graaf)}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={start} disabled={disabled}>
              Start
            </Button>
            <Button size="sm" variant="secondary" onClick={reset} disabled={disabled}>
              Nee
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
