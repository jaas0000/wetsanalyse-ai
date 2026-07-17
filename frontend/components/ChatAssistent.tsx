"use client";

// Zwevende kennisgraaf-assistent "Lex": een chatbel rechtsonder die een paneel opent. Praat via de
// BFF-route /api/chat met de n8n-agent die de GraphDB-kennisgraaf bevraagt (dezelfde agent als
// Telegram). De sessionId (per ingelogde gebruiker, anders localStorage) houdt de gesprekscontext
// vast, zodat de agent vervolgvragen begrijpt. De schrijfstijl van Lex leeft in de n8n-agent-prompt
// (zie docs/lex-schrijfrichtlijn.md); hier strippen we alleen emoji als vangnet. Rijkshuisstijl via
// de bestaande design-tokens.

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendChat } from "@/lib/api";
import { CHAT_HIST_PREFIX, CHAT_SESSIE_KEY } from "@/lib/chatOpslag";
import { Button } from "@/components/ui/Button";
import { Melding } from "@/components/ui/Melding";

type Rol = "user" | "assistent";
interface Bericht {
  rol: Rol;
  tekst: string;
}

// Verbindingsstatus met de assistent: reactief afgeleid uit de laatste chatpoging (geen actieve
// health-probe). "onbekend" = nog niet getest deze sessie (bv. na herladen).
type Verbinding = "onbekend" | "ok" | "fout";

function statusKleur(v: Verbinding): string {
  return v === "ok" ? "bg-succes" : v === "fout" ? "bg-fout" : "bg-waarschuwing";
}
function statusLabel(v: Verbinding): string {
  return v === "ok" ? "actief" : v === "fout" ? "probleem" : "onbekend";
}

const SESSIE_KEY = CHAT_SESSIE_KEY;
const HIST_PREFIX = CHAT_HIST_PREFIX;
const MAX_HIST = 50; // hoeveel berichten we bewaren bij herladen
const WELKOM =
  "Ik ben Lex, de digitale assistent van de Belastingdienst. Ik help je bij het vinden en begrijpen van fiscale wet- en regelgeving uit de kennisgraaf.";
const VOORBEELDEN = [
  "Welke fiscale wetten en regelingen zijn beschikbaar?",
  "Wat betekent het begrip 'belastingschuldige'?",
  "Welke artikelen gaan over de invordering van belastingen?"
];

// Verwijder emoji/emoticons als vangnet: de echte afspraak (geen emoji) leeft in de n8n-agent-prompt.
function stripEmoji(tekst: string): string {
  try {
    return tekst
      // Een eventuele voorafgaande spatie mee-consumeren, zodat "Lex 😊, ..." niet "Lex , ..." wordt.
      .replace(/\s?[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  } catch {
    return tekst;
  }
}

function histKey(sessionId?: string): string {
  return `${HIST_PREFIX}:${sessionId ?? "anon"}`;
}

// De basissessie is stabiel per gebruiker (gedeeld gespreksgeheugen), of een localStorage-id voor
// niet-ingelogde fallback.
function basisSessie(sessionId?: string): string {
  if (sessionId) return `web-${sessionId}`;
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

// Een verse sessie-id (met nonce) zodat het gespreksgeheugen aan de agentkant loskoppelt bij "wissen".
function nieuwGesprek(sessionId?: string): string {
  const nonce =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  return `${basisSessie(sessionId)}-${nonce}`;
}

export function ChatAssistent({ sessionId }: { sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [laatsteVraag, setLaatsteVraag] = useState<string | null>(null);
  const [gekopieerdIdx, setGekopieerdIdx] = useState<number | null>(null);
  const [berichten, setBerichten] = useState<Bericht[]>([{ rol: "assistent", tekst: WELKOM }]);
  const [verbinding, setVerbinding] = useState<Verbinding>("onbekend");

  const sessieRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const belRef = useRef<HTMLButtonElement>(null);
  const invoerRef = useRef<HTMLTextAreaElement>(null);
  const lijstRef = useRef<HTMLDivElement>(null);

  // Sessie + geschiedenis laden: bij voorkeur de bewaarde geschiedenis (per gebruiker), anders vers.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(histKey(sessionId));
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.sessie && Array.isArray(data?.berichten) && data.berichten.length) {
          sessieRef.current = data.sessie;
          setBerichten(data.berichten);
          return;
        }
      }
    } catch {
      /* geen/ongeldige geschiedenis */
    }
    sessieRef.current = basisSessie(sessionId);
  }, [sessionId]);

  // Geschiedenis bewaren (gecapt) zodat een herlaad het gesprek behoudt. Transiënte state niet.
  useEffect(() => {
    if (!sessieRef.current) return;
    try {
      localStorage.setItem(
        histKey(sessionId),
        JSON.stringify({ sessie: sessieRef.current, berichten: berichten.slice(-MAX_HIST) }),
      );
    } catch {
      /* opslag vol/geblokkeerd — niet fataal */
    }
  }, [berichten, sessionId]);

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

  async function stuurVraag(vraag: string, herhaal = false) {
    const tekst = vraag.trim();
    if (!tekst || bezig) return;
    setFout(null);
    setLaatsteVraag(tekst);
    if (!herhaal) setBerichten((b) => [...b, { rol: "user", tekst }]);
    setBezig(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const antwoord = await sendChat(tekst, sessieRef.current, controller.signal);
      setBerichten((b) => [...b, { rol: "assistent", tekst: stripEmoji(antwoord) || "(geen antwoord)" }]);
      setLaatsteVraag(null);
      setVerbinding("ok");
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") {
        // Door de gebruiker afgebroken — stil, geen foutmelding; status ongewijzigd.
      } else {
        const detail =
          (e as { detail?: string })?.detail ?? "Er ging iets mis bij het ophalen van het antwoord.";
        setFout(detail);
        setVerbinding("fout");
      }
    } finally {
      setBezig(false);
      abortRef.current = null;
    }
  }

  function verstuur() {
    const vraag = invoer.trim();
    if (!vraag || bezig) return;
    setInvoer("");
    void stuurVraag(vraag);
  }

  function wis() {
    if (berichten.length <= 1 && !laatsteVraag) return;
    if (!window.confirm("Dit gesprek wissen? Lex begint dan een nieuw gesprek zonder eerdere context."))
      return;
    abortRef.current?.abort();
    sessieRef.current = nieuwGesprek(sessionId);
    setBerichten([{ rol: "assistent", tekst: WELKOM }]);
    setInvoer("");
    setFout(null);
    setLaatsteVraag(null);
    setBezig(false);
  }

  async function kopieer(idx: number, tekst: string) {
    try {
      await navigator.clipboard.writeText(tekst);
      setGekopieerdIdx(idx);
      setTimeout(() => setGekopieerdIdx((v) => (v === idx ? null : v)), 1500);
    } catch {
      /* clipboard niet beschikbaar */
    }
  }

  function opToets(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter = versturen, Shift+Enter = nieuwe regel.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      verstuur();
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
          aria-label={`Open Lex, de kennisgraaf-assistent — verbinding: ${statusLabel(verbinding)}`}
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-paper shadow-lg transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
        >
          <ChatIcoon />
          {/* Verbindingsstatus: groen (actief) / oranje (onbekend) / rood (probleem). */}
          <span
            aria-hidden="true"
            title={`Chatverbinding: ${statusLabel(verbinding)}`}
            className={`absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-paper ${statusKleur(
              verbinding,
            )} ${bezig ? "animate-pulse" : ""}`}
          />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Lex — kennisgraaf-assistent"
          aria-modal="false"
          onKeyDown={(e) => {
            if (e.key === "Escape") sluit();
          }}
          className="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col overflow-hidden border border-line bg-paper shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[32rem] sm:max-h-[calc(100vh-2.5rem)] sm:w-[24rem] sm:rounded-button"
        >
          {/* Kop */}
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-lint">
                <span
                  aria-hidden="true"
                  title={`Chatverbinding: ${statusLabel(verbinding)}`}
                  className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${statusKleur(
                    verbinding,
                  )} ${bezig ? "animate-pulse" : ""}`}
                />
                Lex
              </p>
              <p className="truncate text-xs text-faint">Kennisgraaf-assistent</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={wis}
                aria-label="Wis het gesprek"
                title="Wis het gesprek"
                className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:bg-paper hover:text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
              >
                <WisIcoon />
              </button>
              <button
                type="button"
                onClick={sluit}
                aria-label="Sluit de assistent"
                className="flex h-9 w-9 items-center justify-center rounded-button text-muted transition-colors hover:bg-paper hover:text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
              >
                <SluitIcoon />
              </button>
            </div>
          </div>

          {/* Berichten */}
          <div ref={lijstRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {berichten.map((b, i) => (
              <div key={i} className={b.rol === "user" ? "flex justify-end" : "flex justify-start"}>
                {b.rol === "user" ? (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-button bg-accent px-3 py-2 text-sm text-paper">
                    {b.tekst}
                  </div>
                ) : (
                  <div className="max-w-[85%] rounded-button border border-line bg-surface px-3 py-2 text-sm text-ink">
                    <MarkdownBericht tekst={b.tekst} />
                    {b.tekst !== WELKOM && (
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void kopieer(i, b.tekst)}
                          aria-label={gekopieerdIdx === i ? "Gekopieerd" : "Kopieer antwoord"}
                          title={gekopieerdIdx === i ? "Gekopieerd" : "Kopieer antwoord"}
                          className={`flex h-7 w-7 items-center justify-center rounded-button transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint ${
                            gekopieerdIdx === i ? "text-succes" : "text-muted hover:text-lint"
                          }`}
                        >
                          {gekopieerdIdx === i ? <VinkIcoon /> : <KopieerIcoon />}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Voorbeeldvragen bij een leeg gesprek. */}
            {berichten.length === 1 && !bezig && (
              <div className="flex flex-wrap gap-2 pt-1">
                {VOORBEELDEN.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => void stuurVraag(v)}
                    className="rounded-button border border-line bg-paper px-3 py-1.5 text-left text-xs text-lint transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}

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
              <Melding type="fout" compact>
                <p>{fout}</p>
                {laatsteVraag && (
                  <button
                    type="button"
                    onClick={() => void stuurVraag(laatsteVraag, true)}
                    className="mt-1 text-sm font-medium text-lint underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
                  >
                    Opnieuw
                  </button>
                )}
              </Melding>
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
                aria-label="Je vraag aan Lex"
                className="max-h-32 min-h-[48px] flex-1 resize-none rounded-button border border-line bg-paper px-3 py-3 text-sm text-ink placeholder:text-faint focus-visible:border-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-lint"
              />
              {bezig ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => abortRef.current?.abort()}
                  className="w-auto"
                  aria-label="Stop met antwoorden"
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={verstuur}
                  disabled={!invoer.trim()}
                  className="w-auto"
                  aria-label="Verstuur"
                >
                  Stuur
                </Button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-faint">
              Lex kan fouten maken — controleer altijd de bron.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Rendert een agent-antwoord als (GitHub-flavored) Markdown. react-markdown rendert GEEN rauwe
// HTML (geen rehype-raw), dus veilig; links laten we alleen door voor http(s) en openen extern.
function MarkdownBericht({ tekst }: { tekst: string }) {
  return (
    <div className="space-y-2 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-snug">{children}</p>,
          a: ({ href, children }) => {
            const veilig = typeof href === "string" && /^https?:\/\//i.test(href);
            return veilig ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lint underline underline-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-0.5">{children}</ol>,
          h1: ({ children }) => <p className="text-sm font-semibold text-lint">{children}</p>,
          h2: ({ children }) => <p className="text-sm font-semibold text-lint">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-paper px-1 py-0.5 font-mono text-xs">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded border border-line bg-paper p-2 font-mono text-xs">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-line px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
        }}
      >
        {tekst}
      </ReactMarkdown>
    </div>
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

function WisIcoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KopieerIcoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VinkIcoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Punt() {
  return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />;
}
