"use client";

// Zwevende kennisgraaf-assistent: een chatbel rechtsonder die een paneel opent. Praat via de
// BFF-route /api/chat met de n8n-agent die de GraphDB-kennisgraaf bevraagt (dezelfde agent als
// Telegram). De sessionId (localStorage) houdt de gesprekscontext vast, zodat de agent
// vervolgvragen begrijpt. Rijkshuisstijl via de bestaande design-tokens.

import { useCallback, useEffect, useRef, useState } from "react";
import { sendChat } from "@/lib/api";
import { Button } from "@/components/ui/Button";

type Rol = "user" | "assistent";
interface Bericht {
  rol: Rol;
  tekst: string;
}

const SESSIE_KEY = "kg-chat-sessie";
const WELKOM =
  "Hoi! Ik ben de kennisgraaf-assistent. Vraag me iets over de Nederlandse wet- en regelgeving in de graaf.";

function nieuweSessie(): string {
  try {
    const bestaand = localStorage.getItem(SESSIE_KEY);
    if (bestaand) return bestaand;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSIE_KEY, id);
    return id;
  } catch {
    return `web-${Date.now()}`;
  }
}

export function ChatAssistent() {
  const [open, setOpen] = useState(false);
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [berichten, setBerichten] = useState<Bericht[]>([{ rol: "assistent", tekst: WELKOM }]);

  const sessieRef = useRef<string>("");
  const belRef = useRef<HTMLButtonElement>(null);
  const invoerRef = useRef<HTMLTextAreaElement>(null);
  const lijstRef = useRef<HTMLDivElement>(null);

  // Sessie eenmalig laden (client-only).
  useEffect(() => {
    sessieRef.current = nieuweSessie();
  }, []);

  // Focus het invoerveld bij openen.
  useEffect(() => {
    if (open) invoerRef.current?.focus();
  }, [open]);
  // Scroll naar het laatste bericht.
  useEffect(() => {
    lijstRef.current?.scrollTo({ top: lijstRef.current.scrollHeight, behavior: "smooth" });
  }, [berichten, bezig]);

  const sluit = useCallback(() => {
    setOpen(false);
    belRef.current?.focus(); // focus terug naar de openknop
  }, []);

  async function verstuur() {
    const vraag = invoer.trim();
    if (!vraag || bezig) return;
    setInvoer("");
    setFout(null);
    setBerichten((b) => [...b, { rol: "user", tekst: vraag }]);
    setBezig(true);
    try {
      const antwoord = await sendChat(vraag, sessieRef.current);
      setBerichten((b) => [...b, { rol: "assistent", tekst: antwoord || "(geen antwoord)" }]);
    } catch (e) {
      const detail =
        (e as { detail?: string })?.detail ?? "Er ging iets mis bij het ophalen van het antwoord.";
      setFout(detail);
    } finally {
      setBezig(false);
    }
  }

  function opToets(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = versturen, Shift+Enter = nieuwe regel.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void verstuur();
    }
  }

  return (
    <>
      {/* Zwevende openknop (rechtsonder). */}
      {!open && (
        <button
          ref={belRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open de kennisgraaf-assistent"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-paper shadow-lg transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
        >
          <ChatIcoon />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Kennisgraaf-assistent"
          aria-modal="false"
          onKeyDown={(e) => {
            if (e.key === "Escape") sluit();
          }}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col overflow-hidden border border-line bg-paper shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[32rem] sm:max-h-[calc(100vh-2.5rem)] sm:w-[24rem] sm:rounded-button"
        >
          {/* Kop */}
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-lint">Kennisgraaf-assistent</p>
              <p className="truncate text-xs text-faint">Vraag me iets over de wetgeving.</p>
            </div>
            <button
              type="button"
              onClick={sluit}
              aria-label="Sluit de assistent"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-button text-muted transition-colors hover:bg-paper hover:text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
            >
              <SluitIcoon />
            </button>
          </div>

          {/* Berichten */}
          <div ref={lijstRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {berichten.map((b, i) => (
              <div key={i} className={b.rol === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[85%] whitespace-pre-wrap rounded-button px-3 py-2 text-sm " +
                    (b.rol === "user"
                      ? "bg-accent text-paper"
                      : "border border-line bg-surface text-ink")
                  }
                >
                  {b.tekst}
                </div>
              </div>
            ))}
            {bezig && (
              <div className="flex justify-start">
                <div className="rounded-button border border-line bg-surface px-3 py-2 text-sm text-muted">
                  <span className="inline-flex gap-1" aria-label="Bezig met antwoorden">
                    <Punt /> <Punt /> <Punt />
                  </span>
                </div>
              </div>
            )}
            {fout && (
              <p role="alert" className="rounded-button border border-fout/40 bg-fout/10 px-3 py-2 text-sm text-fout">
                {fout}
              </p>
            )}
          </div>

          {/* Invoer */}
          <div className="border-t border-line bg-paper p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={invoerRef}
                value={invoer}
                onChange={(e) => setInvoer(e.target.value)}
                onKeyDown={opToets}
                rows={1}
                placeholder="Stel een vraag…"
                aria-label="Je vraag aan de assistent"
                className="max-h-32 min-h-[48px] flex-1 resize-none rounded-button border border-line bg-paper px-3 py-3 text-sm text-ink placeholder:text-faint focus-visible:border-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-lint"
              />
              <Button
                type="button"
                onClick={() => void verstuur()}
                disabled={bezig || !invoer.trim()}
                className="w-auto"
                aria-label="Verstuur"
              >
                Stuur
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatIcoon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-4 4v-4H6.5A2.5 2.5 0 0 1 4 12.5v-7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SluitIcoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Punt() {
  return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />;
}
