"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Melding } from "@/components/ui/Melding";
import { annoteerAgentStream, isApiError } from "@/lib/api";
import type { AgentDoel, VoorstelElement } from "@/lib/types";

function foutTekst(e: unknown): string {
  if (isApiError(e)) return e.detail;
  return (e as Error)?.message ?? "Er ging iets mis.";
}

/** Vraag de unified agent een artikel te annoteren. De supervisor kiest de annotatie-worker, haalt de
 *  tekst via de tools op en streamt het doel + de JAS-elementen; die geven we door aan de workbench. */
export function AgentIngang({
  onResultaat,
  disabled,
}: {
  onResultaat: (doel: AgentDoel, elementen: VoorstelElement[]) => void;
  disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [bezig, setBezig] = useState(false);
  const [status, setStatus] = useState("");
  const [fout, setFout] = useState<string | null>(null);

  async function verstuur() {
    if (!prompt.trim()) return;
    setFout(null);
    setBezig(true);
    setStatus("Agent denkt na…");
    const holder: { doel: AgentDoel | null } = { doel: null };
    const elementen: VoorstelElement[] = [];
    try {
      await annoteerAgentStream(prompt.trim(), {
        onStatus: setStatus,
        onDoel: (d) => (holder.doel = d),
        onElement: (el) => elementen.push(el),
      });
      const doel = holder.doel;
      if (!doel || !doel.bwbId) {
        setFout(
          "De agent kon geen artikel bepalen om te annoteren. Formuleer bijv. “annoteer artikel 9 lid 1 van de Invorderingswet 1990”.",
        );
        return;
      }
      onResultaat(doel, elementen);
      setPrompt("");
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
      setStatus("");
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
              if (e.key === "Enter" && !bezig) verstuur();
            }}
            placeholder="bijv. annoteer artikel 9 lid 1 van de Invorderingswet 1990"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            disabled={disabled || bezig}
          />
          <Button onClick={verstuur} disabled={disabled || bezig || !prompt.trim()} className="w-full sm:w-auto">
            {bezig ? "Bezig…" : "Annoteer"}
          </Button>
        </div>
      </label>

      {status && <p className="mt-2 text-xs text-muted">{status}</p>}
      {fout && <div className="mt-3"><Melding type="fout">{fout}</Melding></div>}
    </div>
  );
}
