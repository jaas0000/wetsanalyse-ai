"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ArtefactPaneel } from "@/components/werkplek/ArtefactPaneel";
import { Markdown } from "@/components/werkplek/Markdown";
import {
  annoteerAgentStream,
  beslis,
  haalArtikelGraaf,
  haalDocument,
  haalGesprek,
  isApiError,
  maakDocument,
  maakGesprek,
  voegBerichtToe,
  zetElementen,
} from "@/lib/api";
import type {
  AgentDoel,
  AnnotatieDocument,
  BeslissingInvoer,
  Bron,
  GraafArtikel,
  OntbrekendItem,
  VoorstelElement,
} from "@/lib/types";
import { wettenOverheidHref } from "@/lib/url";

type Item =
  | { id: string; type: "user"; tekst: string }
  | { id: string; type: "antwoord"; tekst: string; denk?: string; bronnen?: Bron[] }
  | { id: string; type: "annotatie"; slug: string; ontbrekend?: OntbrekendItem[] };

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function foutTekst(e: unknown): string {
  if (isApiError(e)) return e.detail;
  return (e as Error)?.message ?? "Er ging iets mis.";
}

interface Props {
  /** Het te openen gesprek, of `null` voor een vers (nog niet gepersisteerd) gesprek. */
  initialGesprekId: string | null;
  /** Roept terug zodra bij de eerste beurt een gesprek is aangemaakt (voor sidebar-highlight + lijst). */
  onGesprekAangemaakt: (id: string) => void;
  /** Roept terug na elke persistente wijziging zodat de sidebar-lijst kan verversen. */
  onGewijzigd: () => void;
}

export function WerkplekClient({ initialGesprekId, onGesprekAangemaakt, onGewijzigd }: Props) {
  const [gesprekId, setGesprekId] = useState<string | null>(initialGesprekId);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Record<string, AnnotatieDocument>>({});
  const [infos, setInfos] = useState<Record<string, GraafArtikel>>({});
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [actiefId, setActiefId] = useState<string | undefined>();
  const [artefactSlug, setArtefactSlug] = useState<string | undefined>();
  const lijstRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Hydrateer één keer bij mount: bestaande gespreksberichten → thread. (De shell remount dit component
  // via een key wanneer echt van gesprek wordt gewisseld, dus dit hoeft niet op gesprekId te reageren.)
  useEffect(() => {
    if (!initialGesprekId) return;
    let afgebroken = false;
    haalGesprek(initialGesprekId)
      .then((g) => {
        if (afgebroken) return;
        setItems(
          g.berichten.map((b) =>
            b.rol === "user"
              ? { id: uid(), type: "user" as const, tekst: b.tekst }
              : b.annotatie_slug
                ? { id: uid(), type: "annotatie" as const, slug: b.annotatie_slug, ontbrekend: b.ontbrekend }
                : { id: uid(), type: "antwoord" as const, tekst: b.tekst, denk: b.denk, bronnen: b.bronnen },
          ),
        );
        // Documenten van annotatie-berichten alvast laden voor de chip-labels.
        for (const b of g.berichten) if (b.annotatie_slug) void laadDoc(b.annotatie_slug);
      })
      .catch(() => {});
    return () => {
      afgebroken = true;
    };
  }, [initialGesprekId]);

  useEffect(() => {
    lijstRef.current?.scrollTo({ top: lijstRef.current.scrollHeight, behavior: "smooth" });
  }, [items, bezig]);

  // Auto-groeiende textarea (groeit met de inhoud tot een max; daarna intern scrollen).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [invoer]);

  function updateItem(id: string, patch: Partial<Item>) {
    setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));
  }

  async function laadDoc(slug: string): Promise<AnnotatieDocument | null> {
    try {
      const document = await haalDocument(slug);
      setDocs((m) => ({ ...m, [slug]: document }));
      return document;
    } catch {
      return null;
    }
  }

  async function openArtefact(slug: string) {
    const doc = docs[slug] ?? (await laadDoc(slug));
    if (!doc) return;
    if (!infos[slug]) {
      try {
        const graaf = await haalArtikelGraaf(doc.bwbId, doc.artikel, doc.lid);
        setInfos((m) => ({ ...m, [slug]: graaf }));
      } catch {
        /* zonder graaf geen paneel */
        return;
      }
    }
    setArtefactSlug(slug);
  }

  /** Persisteer één beurt (best-effort; een mislukte opslag mag de chat niet blokkeren). */
  async function persisteer(gid: string, rol: "user" | "assistant", velden: Record<string, unknown>) {
    try {
      await voegBerichtToe(gid, { rol, ...velden });
    } catch {
      /* stil — de UI toont de beurt sowieso */
    }
  }

  async function verstuur(vast?: string) {
    const prompt = (vast ?? invoer).trim();
    if (!prompt || bezig) return;
    setInvoer("");

    // Zorg voor een gesprek-id (maak er bij de eerste beurt één aan; titel = de vraag, afgekapt).
    let gid = gesprekId;
    if (!gid) {
      try {
        const g = await maakGesprek(prompt.slice(0, 80));
        gid = g.id;
        setGesprekId(gid);
        onGesprekAangemaakt(gid);
      } catch (e) {
        setItems((xs) => [...xs, { id: uid(), type: "antwoord", tekst: `⚠️ ${foutTekst(e)}` }]);
        return;
      }
    }

    const antId = uid();
    setItems((xs) => [...xs, { id: uid(), type: "user", tekst: prompt }, { id: antId, type: "antwoord", tekst: "" }]);
    setBezig(true);
    void persisteer(gid, "user", { tekst: prompt });

    const doelRef: { d: AgentDoel | null } = { d: null };
    const els: VoorstelElement[] = [];
    const ontbrekend: OntbrekendItem[] = [];
    let tekst = "";
    let denk = "";
    let bronnen: Bron[] = [];
    try {
      await annoteerAgentStream(
        prompt,
        {
          onStatus: (m) => {
            denk += (denk ? "\n" : "") + "· " + m;
            updateItem(antId, { denk });
          },
          onReason: (t) => {
            denk += t;
            updateItem(antId, { denk });
          },
          onToken: (t) => {
            tekst += t;
            updateItem(antId, { tekst });
          },
          onSources: (b) => {
            bronnen = b;
            updateItem(antId, { bronnen: b });
          },
          onDoel: (d) => (doelRef.d = d),
          onElement: (e) => els.push(e),
          onOntbrekend: (xs) => ontbrekend.push(...xs),
        },
        gid,
      );

      const doel = doelRef.d;
      if (doel && doel.bwbId) {
        const graaf: GraafArtikel = doel.leden_teksten?.length
          ? {
              bwbId: doel.bwbId,
              artikel: doel.artikel,
              citeertitel: doel.citeertitel ?? "",
              opschrift: "",
              leden_teksten: doel.leden_teksten,
            }
          : await haalArtikelGraaf(doel.bwbId, doel.artikel, doel.lid);
        const document = await maakDocument({
          bwbId: doel.bwbId,
          artikel: doel.artikel,
          lid: doel.lid || null,
          werkgebied: doel.citeertitel || "",
        });
        const bijgewerkt = await zetElementen(document.slug, els);
        setDocs((m) => ({ ...m, [bijgewerkt.slug]: bijgewerkt }));
        setInfos((m) => ({ ...m, [bijgewerkt.slug]: graaf }));
        setItems((xs) =>
          xs.map((x) =>
            x.id === antId ? { id: antId, type: "annotatie", slug: bijgewerkt.slug, ontbrekend } : x,
          ),
        );
        setArtefactSlug(bijgewerkt.slug); // schuif het artefact meteen in
        void persisteer(gid, "assistant", { annotatie_slug: bijgewerkt.slug, ontbrekend });
      } else {
        if (!tekst.trim()) updateItem(antId, { tekst: "(geen antwoord)" });
        void persisteer(gid, "assistant", { tekst: tekst.trim() || "(geen antwoord)", denk, bronnen });
      }
      onGewijzigd();
    } catch (e) {
      updateItem(antId, { tekst: `⚠️ ${foutTekst(e)}` });
    } finally {
      setBezig(false);
    }
  }

  async function beslissing(slug: string, elementId: string, req: BeslissingInvoer) {
    try {
      const bij = await beslis(slug, elementId, req);
      setDocs((m) => ({ ...m, [slug]: bij }));
    } catch (e) {
      setItems((xs) => [...xs, { id: uid(), type: "antwoord", tekst: `⚠️ Beslissing mislukt: ${foutTekst(e)}` }]);
    }
  }

  function opToets(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void verstuur();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread — enige scrollende gebied; berichten in een gecentreerde leeskolom */}
      <div ref={lijstRef} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
          {items.length === 0 && (
            <div className="pt-[10dvh] text-center">
              <p className="font-display text-2xl font-semibold text-lint">Waarmee kan ik helpen?</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Stel een vraag over de wet- en regelgeving, of vraag een annotatie volgens het JAS.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {VOORBEELDEN.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => void verstuur(v)}
                    className="rounded-bubbel border border-line bg-paper px-3.5 py-2 text-left text-xs text-lint shadow-zacht transition-all hover:-translate-y-0.5 hover:border-lint/40 hover:shadow-kaart"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item) =>
            item.type === "user" ? (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubbel bg-lint/10 px-4 py-2.5 text-sm text-ink">
                  {item.tekst}
                </div>
              </div>
            ) : item.type === "antwoord" ? (
              <div key={item.id} className="text-sm text-ink">
                {item.denk && <DenkProces tekst={item.denk} actief={bezig && !item.tekst} />}
                {item.tekst ? <Markdown tekst={item.tekst} /> : item.denk ? null : <Punten />}
                {item.bronnen && item.bronnen.length > 0 && <Bronnen bronnen={item.bronnen} />}
              </div>
            ) : (
              <AnnotatieChip
                key={item.id}
                doc={docs[item.slug]}
                aantal={docs[item.slug]?.elementen.length}
                onOpen={() => void openArtefact(item.slug)}
              />
            ),
          )}
        </div>
      </div>

      {/* Invoerbalk — gepind onderaan, gecentreerd, auto-groeiend */}
      <div className="shrink-0 bg-paper">
        <div className="mx-auto max-w-3xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <div className="flex items-end gap-2 rounded-bubbel border border-line bg-white px-2 py-1.5 shadow-zacht transition-shadow focus-within:border-lint focus-within:shadow-kaart">
            <textarea
              ref={taRef}
              value={invoer}
              onChange={(e) => setInvoer(e.target.value)}
              onKeyDown={opToets}
              rows={1}
              placeholder="Stel een vraag of vraag een annotatie…"
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-faint focus:outline-none"
            />
            <button
              type="button"
              onClick={() => verstuur()}
              disabled={bezig || !invoer.trim()}
              aria-label="Versturen"
              className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-paper transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
            >
              {bezig ? (
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-paper" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-faint">
            De agent bevraagt de kennisgraaf — controleer altijd de bron.
          </p>
        </div>
      </div>

      {/* Annotatie-artefact (slide-in) */}
      {artefactSlug && docs[artefactSlug] && infos[artefactSlug] && (
        <ArtefactPaneel
          doc={docs[artefactSlug]}
          info={infos[artefactSlug]}
          ontbrekend={
            (items.find((x) => x.type === "annotatie" && x.slug === artefactSlug) as
              | { ontbrekend?: OntbrekendItem[] }
              | undefined)?.ontbrekend
          }
          actiefId={actiefId}
          onKies={setActiefId}
          onBeslissing={(elementId, req) => beslissing(artefactSlug, elementId, req)}
          onSluit={() => setArtefactSlug(undefined)}
        />
      )}
    </div>
  );
}

const VOORBEELDEN = [
  "Wat betekent het begrip 'belastingschuldige'?",
  "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
  "Welke artikelen gaan over invordering?",
];

/** Compacte kaart in de chatstroom die naar het annotatie-artefact leidt (opent het slide-in paneel). */
function AnnotatieChip({
  doc,
  aantal,
  onOpen,
}: {
  doc?: AnnotatieDocument;
  aantal?: number;
  onOpen: () => void;
}) {
  const titel = doc ? `${doc.werkgebied || doc.bwbId} — art. ${doc.artikel}${doc.lid ? ` lid ${doc.lid}` : ""}` : "Annotatie";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-kaart border border-line bg-surface px-4 py-3 text-left shadow-zacht transition-all hover:-translate-y-0.5 hover:border-lint/40 hover:shadow-kaart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-lint/10 text-lint" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6M9 13l2 2 4-4" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{titel}</span>
        <span className="block text-xs text-muted">
          JAS-annotatie{typeof aantal === "number" ? ` · ${aantal} elementen` : ""} · review openen
        </span>
      </span>
      <span className="shrink-0 text-muted" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </span>
    </button>
  );
}

function Punten() {
  return (
    <span className="inline-flex gap-1" aria-label="Bezig">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
    </span>
  );
}

// Inklapbaar "Denkproces"-blok (Claude-stijl): streamt live terwijl de agent werkt (`actief`) en klapt
// automatisch dicht zodra het antwoord er is. De gebruiker kan het handmatig weer openen.
function DenkProces({ tekst, actief }: { tekst: string; actief: boolean }) {
  const [keuze, setKeuze] = useState<boolean | null>(null);
  const open = keuze ?? actief;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setKeuze(!open)}
        className="inline-flex items-center gap-1.5 rounded-full px-1 text-xs text-muted transition-colors hover:text-ink"
        aria-expanded={open}
      >
        {actief && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-soft" aria-hidden />}
        <span>{actief ? "Denkt na…" : "Denkproces"}</span>
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ▸
        </span>
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap rounded-kaart border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
          {tekst}
        </div>
      )}
    </div>
  );
}

// Inklapbare bronnenlijst — standaard dicht met een teller, want de lijst kan lang zijn.
function Bronnen({ bronnen }: { bronnen: Bron[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
        aria-expanded={open}
      >
        <span className="font-medium">Bronnen ({bronnen.length})</span>
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ▸
        </span>
      </button>
      {open && (
        <div className="mt-1.5 break-words rounded-kaart border border-line bg-surface px-3 py-2 text-xs text-muted [overflow-wrap:anywhere]">
          {bronnen.map((b, i) => {
            const href = wettenOverheidHref(b.uri);
            return (
              <span key={i}>
                {i > 0 && ", "}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-lint underline underline-offset-2 [overflow-wrap:anywhere]"
                  >
                    {b.label}
                  </a>
                ) : (
                  b.label
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
