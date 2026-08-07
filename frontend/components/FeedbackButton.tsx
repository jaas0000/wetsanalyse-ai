"use client";

import { useEffect, useRef, useState } from "react";
import { stuurFeedback } from "@/lib/api";
import { isApiError } from "@/lib/api";

type Categorie = "verbeteridee" | "probleemmelding" | "compliment" | "vraag";

const CATEGORIEEN: { waarde: Categorie; label: string }[] = [
  { waarde: "verbeteridee", label: "Verbeteridee" },
  { waarde: "probleemmelding", label: "Probleemmelding" },
  { waarde: "compliment", label: "Compliment" },
  { waarde: "vraag", label: "Vraag" },
];

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [categorie, setCategorie] = useState<Categorie>("verbeteridee");
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  const [verzonden, setVerzonden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const eersteInputRef = useRef<HTMLInputElement>(null);

  // Sluit modal op Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") sluit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus eerste radio bij openen
  useEffect(() => {
    if (open && !verzonden) eersteInputRef.current?.focus();
  }, [open, verzonden]);

  function sluit() {
    setOpen(false);
    // Reset na sluitanimatie
    setTimeout(() => {
      setVerzonden(false);
      setTekst("");
      setCategorie("verbeteridee");
      setFout(null);
    }, 150);
  }

  async function verzend() {
    if (!tekst.trim()) {
      setFout("Vul een bericht in.");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      await stuurFeedback({
        categorie,
        tekst: tekst.trim(),
        pagina: typeof window !== "undefined" ? window.location.pathname : undefined,
      });
      setVerzonden(true);
    } catch (e) {
      setFout(isApiError(e) ? e.detail : "Er is iets misgegaan. Probeer het opnieuw.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <>
      {/* Floating knop */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Feedback geven"
        className="fixed bottom-6 right-6 z-40 flex min-h-[48px] items-center gap-2 rounded-button border border-transparent bg-accent px-4 py-2 text-sm font-medium text-paper shadow-lg transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
      >
        <span aria-hidden>💬</span>
        Feedback
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-6 sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-titel"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={sluit}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            ref={panelRef}
            className="relative z-10 w-full max-w-md rounded-lg border border-line bg-paper p-6 shadow-xl"
          >
            {verzonden ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <span className="text-3xl" aria-hidden>✓</span>
                <p className="font-semibold text-lint">Bedankt voor uw feedback!</p>
                <p className="text-sm text-muted">
                  Uw bericht is ontvangen en wordt meegenomen in de doorontwikkeling.
                </p>
                <button
                  onClick={sluit}
                  className="mt-2 min-h-[48px] rounded-button border border-lint px-5 py-2 text-sm font-medium text-lint transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
                >
                  Sluiten
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 id="feedback-titel" className="text-base font-semibold text-lint">
                    Feedback geven
                  </h2>
                  <button
                    onClick={sluit}
                    aria-label="Sluiten"
                    className="flex h-8 w-8 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
                  >
                    ✕
                  </button>
                </div>

                {/* Categorie */}
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-medium text-ink">Categorie</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORIEEN.map(({ waarde, label }, i) => (
                      <label
                        key={waarde}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                          categorie === waarde
                            ? "border-lint bg-lint/5 font-medium text-lint"
                            : "border-line bg-paper text-ink hover:bg-surface"
                        }`}
                      >
                        <input
                          ref={i === 0 ? eersteInputRef : undefined}
                          type="radio"
                          name="categorie"
                          value={waarde}
                          checked={categorie === waarde}
                          onChange={() => setCategorie(waarde)}
                          className="accent-lint"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* Tekst */}
                <div className="mb-4">
                  <label
                    htmlFor="feedback-tekst"
                    className="mb-1.5 block text-sm font-medium text-ink"
                  >
                    Bericht
                  </label>
                  <textarea
                    id="feedback-tekst"
                    value={tekst}
                    onChange={(e) => setTekst(e.target.value)}
                    placeholder="Beschrijf uw idee, probleem of vraag…"
                    rows={4}
                    maxLength={4000}
                    className="w-full rounded border border-line bg-paper px-3 py-2 text-sm text-ink placeholder-muted focus:border-lint focus:outline-none focus:ring-1 focus:ring-lint disabled:opacity-50"
                    disabled={bezig}
                  />
                  <p className="mt-1 text-right text-xs text-muted">
                    {tekst.length}/4000
                  </p>
                </div>

                {fout && (
                  <p className="mb-3 text-sm text-fout" role="alert">
                    {fout}
                  </p>
                )}

                {/* Acties */}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={sluit}
                    disabled={bezig}
                    className="min-h-[48px] rounded-button border border-lint px-5 py-2 text-sm font-medium text-lint transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint disabled:opacity-50"
                  >
                    Annuleren
                  </button>
                  <button
                    onClick={verzend}
                    disabled={bezig || !tekst.trim()}
                    className="min-h-[48px] rounded-button border border-transparent bg-accent px-5 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bezig ? "Verzenden…" : "Verzenden"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
