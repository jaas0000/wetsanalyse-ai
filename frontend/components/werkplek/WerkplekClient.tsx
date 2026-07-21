"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/werkplek/Markdown";
import { DocumentLijst } from "@/components/workbench/DocumentLijst";
import { DocumentPaneel } from "@/components/workbench/DocumentPaneel";
import { ReviewQueue } from "@/components/workbench/ReviewQueue";
import {
  annoteerAgentStream,
  beslis,
  haalArtikelGraaf,
  haalDocument,
  isApiError,
  lijstDocumenten,
  listWetten,
  maakDocument,
  verwijderDocument,
  zetElementen,
} from "@/lib/api";
import type {
  AgentDoel,
  AnnotatieDocument,
  BeslissingInvoer,
  Bron,
  DocumentSamenvatting,
  GraafArtikel,
  VoorstelElement,
  WetChoice,
} from "@/lib/types";
import { wettenOverheidHref } from "@/lib/url";

type Item =
  | { id: string; type: "user"; tekst: string }
  | { id: string; type: "antwoord"; tekst: string; bronnen?: Bron[] }
  | { id: string; type: "annotatie"; slug: string };

const SESSIE_KEY = "wa_werkplek_sessie";

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function foutTekst(e: unknown): string {
  if (isApiError(e)) return e.detail;
  return (e as Error)?.message ?? "Er ging iets mis.";
}

function sessie(): string {
  try {
    const bestaand = localStorage.getItem(SESSIE_KEY);
    if (bestaand) return bestaand;
    const id = `web-${crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    localStorage.setItem(SESSIE_KEY, id);
    return id;
  } catch {
    return `web-${Date.now()}`;
  }
}

function ledenVan(info: GraafArtikel): string[] {
  return info.leden_teksten.map((l) => (l.lid ? `${l.lid}. ${l.tekst}` : l.tekst)).filter(Boolean);
}

export function WerkplekClient() {
  const [wetten, setWetten] = useState<WetChoice[]>([]);
  const [documenten, setDocumenten] = useState<DocumentSamenvatting[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Record<string, AnnotatieDocument>>({});
  const [infos, setInfos] = useState<Record<string, GraafArtikel>>({});
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [actiefId, setActiefId] = useState<string | undefined>();
  const sessieRef = useRef<string>("");
  const lijstRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessieRef.current = sessie();
    listWetten().then(setWetten).catch(() => setWetten([]));
    verversLijst();
  }, []);

  useEffect(() => {
    lijstRef.current?.scrollTo({ top: lijstRef.current.scrollHeight, behavior: "smooth" });
  }, [items, bezig]);

  function verversLijst() {
    lijstDocumenten().then(setDocumenten).catch(() => {});
  }
  function updateItem(id: string, patch: Partial<Item>) {
    setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));
  }

  async function verstuur() {
    const prompt = invoer.trim();
    if (!prompt || bezig) return;
    setInvoer("");
    const antId = uid();
    setItems((xs) => [...xs, { id: uid(), type: "user", tekst: prompt }, { id: antId, type: "antwoord", tekst: "" }]);
    setBezig(true);

    const doelRef: { d: AgentDoel | null } = { d: null };
    const els: VoorstelElement[] = [];
    let tekst = "";
    try {
      await annoteerAgentStream(
        prompt,
        {
          onToken: (t) => {
            tekst += t;
            updateItem(antId, { tekst });
          },
          onSources: (b) => updateItem(antId, { bronnen: b }),
          onDoel: (d) => (doelRef.d = d),
          onElement: (e) => els.push(e),
        },
        sessieRef.current,
      );

      const doel = doelRef.d;
      if (doel && doel.bwbId) {
        const [document, graaf] = await Promise.all([
          maakDocument({ bwbId: doel.bwbId, artikel: doel.artikel, lid: doel.lid || null }),
          haalArtikelGraaf(doel.bwbId, doel.artikel, doel.lid),
        ]);
        const bijgewerkt = await zetElementen(document.slug, els);
        setDocs((m) => ({ ...m, [bijgewerkt.slug]: bijgewerkt }));
        setInfos((m) => ({ ...m, [bijgewerkt.slug]: graaf }));
        setItems((xs) => xs.map((x) => (x.id === antId ? { id: antId, type: "annotatie", slug: bijgewerkt.slug } : x)));
        verversLijst();
      } else if (!tekst.trim()) {
        updateItem(antId, { tekst: "(geen antwoord)" });
      }
    } catch (e) {
      updateItem(antId, { tekst: `⚠️ ${foutTekst(e)}` });
    } finally {
      setBezig(false);
    }
  }

  async function openDocument(slug: string) {
    if (!docs[slug]) {
      try {
        const document = await haalDocument(slug);
        const graaf = await haalArtikelGraaf(document.bwbId, document.artikel, document.lid);
        setDocs((m) => ({ ...m, [slug]: document }));
        setInfos((m) => ({ ...m, [slug]: graaf }));
      } catch (e) {
        setItems((xs) => [...xs, { id: uid(), type: "antwoord", tekst: `⚠️ ${foutTekst(e)}` }]);
        return;
      }
    }
    setItems((xs) => [...xs, { id: uid(), type: "annotatie", slug }]);
  }

  async function verwijder(slug: string) {
    if (!window.confirm("Dit annotatie-document verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    try {
      await verwijderDocument(slug);
      setItems((xs) => xs.filter((x) => !(x.type === "annotatie" && x.slug === slug)));
      verversLijst();
    } catch {
      /* stil */
    }
  }

  async function beslissing(slug: string, elementId: string, req: BeslissingInvoer) {
    try {
      const bij = await beslis(slug, elementId, req);
      setDocs((m) => ({ ...m, [slug]: bij }));
      verversLijst();
    } catch {
      /* stil */
    }
  }

  function opToets(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void verstuur();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,260px)_1fr]">
      <DocumentLijst
        documenten={documenten}
        wetten={wetten}
        onOpen={openDocument}
        onNew={() => setItems([])}
        onVerwijder={verwijder}
      />

      <div className="flex min-h-[70vh] flex-col">
        <div ref={lijstRef} className="flex-1 space-y-4 overflow-y-auto pb-4" aria-live="polite">
          {items.length === 0 && (
            <p className="text-sm text-muted">
              Stel een vraag over de wet- en regelgeving, of vraag een annotatie — bijv.{" "}
              <span className="font-medium text-ink">
                “annoteer artikel 9 lid 1 van de Invorderingswet 1990”
              </span>
              .
            </p>
          )}

          {items.map((item) =>
            item.type === "user" ? (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-accent px-3 py-2 text-sm text-paper">
                  {item.tekst}
                </div>
              </div>
            ) : item.type === "antwoord" ? (
              <div key={item.id} className="flex justify-start">
                <div className="max-w-[90%] rounded-xl border border-line bg-white px-3 py-2">
                  {item.tekst ? <Markdown tekst={item.tekst} /> : <Punten />}
                  {item.bronnen && item.bronnen.length > 0 && (
                    <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
                      <span className="font-medium">Bronnen:</span>{" "}
                      {item.bronnen.map((b, i) => {
                        const href = wettenOverheidHref(b.uri);
                        return (
                          <span key={i}>
                            {i > 0 && ", "}
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="text-lint underline underline-offset-2">
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
              </div>
            ) : docs[item.slug] && infos[item.slug] ? (
              <AnnotatieKaart
                key={item.id}
                doc={docs[item.slug]}
                info={infos[item.slug]}
                actiefId={actiefId}
                onKies={setActiefId}
                onBeslissing={(elementId, req) => beslissing(item.slug, elementId, req)}
              />
            ) : null,
          )}

          {bezig && <Punten />}
        </div>

        <div className="border-t border-line pt-3">
          <div className="flex items-end gap-2">
            <textarea
              value={invoer}
              onChange={(e) => setInvoer(e.target.value)}
              onKeyDown={opToets}
              rows={1}
              placeholder="Stel een vraag of vraag een annotatie…"
              className="max-h-40 min-h-[48px] flex-1 resize-none rounded-lg border border-line bg-white px-3 py-3 text-sm text-ink placeholder:text-faint focus-visible:border-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-lint"
            />
            <Button onClick={verstuur} disabled={bezig || !invoer.trim()} className="w-auto">
              {bezig ? "Bezig…" : "Stuur"}
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-faint">
            De agent bevraagt de kennisgraaf — controleer altijd de bron.
          </p>
        </div>
      </div>
    </div>
  );
}

function AnnotatieKaart({
  doc,
  info,
  actiefId,
  onKies,
  onBeslissing,
}: {
  doc: AnnotatieDocument;
  info: GraafArtikel;
  actiefId?: string;
  onKies: (id?: string) => void;
  onBeslissing: (elementId: string, req: BeslissingInvoer) => Promise<void>;
}) {
  const opschrift = `${info.citeertitel || doc.bwbId} — artikel ${info.artikel}${doc.lid ? ` lid ${doc.lid}` : ""}`;
  return (
    <div className="grid gap-4 rounded-xl border border-line bg-surface p-3 lg:grid-cols-[1.4fr_1fr]">
      <DocumentPaneel
        opschrift={opschrift}
        leden={ledenVan(info)}
        elementen={doc.elementen.map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst }))}
        actiefId={actiefId}
        onKies={onKies}
      />
      <div>
        {doc.elementen.length > 0 ? (
          <ReviewQueue elementen={doc.elementen} actiefId={actiefId} onKies={onKies} onBeslissing={onBeslissing} />
        ) : (
          <p className="text-sm text-muted">Geen elementen.</p>
        )}
      </div>
    </div>
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
