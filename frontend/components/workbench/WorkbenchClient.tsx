"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Melding } from "@/components/ui/Melding";
import { DocumentLijst } from "@/components/workbench/DocumentLijst";
import { DocumentPaneel, type Markeerbaar } from "@/components/workbench/DocumentPaneel";
import { ReviewQueue } from "@/components/workbench/ReviewQueue";
import {
  annoteerStream,
  beslis,
  getArtikelInfo,
  haalDocument,
  isApiError,
  lijstDocumenten,
  listWetten,
  maakDocument,
  verwijderDocument,
  zetElementen,
} from "@/lib/api";
import type {
  AnnotatieDocument,
  ArtikelInfo,
  BeslissingInvoer,
  DocumentSamenvatting,
  VoorstelElement,
  WetChoice,
} from "@/lib/types";

function foutTekst(e: unknown): string {
  if (isApiError(e)) return e.detail;
  return (e as Error)?.message ?? "Er ging iets mis.";
}

export function WorkbenchClient() {
  const [wetten, setWetten] = useState<WetChoice[]>([]);
  const [documenten, setDocumenten] = useState<DocumentSamenvatting[]>([]);
  const [modus, setModus] = useState<"nieuw" | "open">("nieuw");
  const [bwbId, setBwbId] = useState("");
  const [artikel, setArtikel] = useState("");
  const [doc, setDoc] = useState<AnnotatieDocument | null>(null);
  const [info, setInfo] = useState<ArtikelInfo | null>(null);
  const [voorstellen, setVoorstellen] = useState<VoorstelElement[]>([]);
  const [status, setStatus] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [actiefId, setActiefId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listWetten().then(setWetten).catch(() => setWetten([]));
    verversLijst();
  }, []);

  function verversLijst() {
    lijstDocumenten().then(setDocumenten).catch(() => {});
  }

  function nieuweAnnotatie() {
    setModus("nieuw");
    setDoc(null);
    setInfo(null);
    setVoorstellen([]);
    setStatus("");
    setFout(null);
    setActiefId(undefined);
    setBwbId("");
    setArtikel("");
  }

  async function openDocument(slug: string) {
    setFout(null);
    setStatus("");
    setBezig(true);
    setVoorstellen([]);
    try {
      const document = await haalDocument(slug);
      setDoc(document);
      setBwbId(document.bwbId);
      setArtikel(document.artikel);
      setModus("open");
      const artikelInfo = await getArtikelInfo(document.bwbId, document.artikel);
      setInfo(artikelInfo);
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  async function verwijder(slug: string) {
    if (!window.confirm("Dit annotatie-document verwijderen? Dit kan niet ongedaan worden gemaakt.")) {
      return;
    }
    try {
      await verwijderDocument(slug);
      if (doc?.slug === slug) nieuweAnnotatie();
      verversLijst();
    } catch (e) {
      setFout(foutTekst(e));
    }
  }

  async function start() {
    setFout(null);
    if (!bwbId || !artikel.trim()) {
      setFout("Kies een wet en vul een artikelnummer in.");
      return;
    }
    setBezig(true);
    setVoorstellen([]);
    setStatus("Artikel ophalen…");
    try {
      const [document, artikelInfo] = await Promise.all([
        maakDocument({ bwbId, artikel: artikel.trim() }),
        getArtikelInfo(bwbId, artikel.trim()),
      ]);
      setDoc(document);
      setInfo(artikelInfo);
      setModus("open");

      const controller = new AbortController();
      abortRef.current = controller;
      const verzameld: VoorstelElement[] = [];
      await annoteerStream(
        bwbId,
        artikel.trim(),
        {
          onStatus: setStatus,
          onElement: (el) => {
            verzameld.push(el);
            setVoorstellen([...verzameld]);
          },
        },
        controller.signal,
      );

      const bijgewerkt = await zetElementen(document.slug, verzameld);
      setDoc(bijgewerkt);
      setVoorstellen([]);
      setStatus(`${bijgewerkt.elementen.length} elementen voorgesteld.`);
      verversLijst();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
      abortRef.current = null;
    }
  }

  async function beslissing(elementId: string, req: BeslissingInvoer) {
    if (!doc) return;
    try {
      setDoc(await beslis(doc.slug, elementId, req));
      verversLijst();
    } catch (e) {
      setFout(foutTekst(e));
    }
  }

  const markeerbaar: Markeerbaar[] = useMemo(() => {
    if (doc && doc.elementen.length) {
      return doc.elementen.map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst }));
    }
    return voorstellen.map((v, i) => ({ id: `v${i}`, klasse: v.klasse, tekst: v.tekst }));
  }, [doc, voorstellen]);

  // De volledige lid-teksten (leden_teksten) voor het documentpaneel; val terug op de lid-nummers.
  const leden = useMemo(() => {
    const lt = info?.leden_teksten;
    if (lt && lt.length) return lt.map((l) => (l.tekst ? `${l.lid}. ${l.tekst}` : "")).filter(Boolean);
    return info?.leden ?? [];
  }, [info]);
  const persistent = (doc?.elementen.length ?? 0) > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,260px)_1fr]">
      <DocumentLijst
        documenten={documenten}
        wetten={wetten}
        activeSlug={doc?.slug}
        onOpen={openDocument}
        onNew={nieuweAnnotatie}
        onVerwijder={verwijder}
      />

      <div className="space-y-4">
        {/* artikel kiezen (alleen bij een nieuwe annotatie) */}
        {modus === "nieuw" && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-medium text-ink">Wet</span>
              <select
                value={bwbId}
                onChange={(e) => setBwbId(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              >
                <option value="">— kies een wet —</option>
                {wetten.map((w) => (
                  <option key={w.bwbId} value={w.bwbId}>
                    {w.naam || w.bwbId}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-full text-sm sm:w-40">
              <span className="mb-1 block font-medium text-ink">Artikel</span>
              <input
                value={artikel}
                onChange={(e) => setArtikel(e.target.value)}
                placeholder="bijv. 9"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
            </label>
            <Button onClick={start} disabled={bezig} className="w-full sm:w-auto">
              {bezig ? "Bezig…" : "Annoteer"}
            </Button>
          </div>
        )}

        {fout && <Melding type="fout">{fout}</Melding>}
        {status && <p className="text-sm text-muted">{status}</p>}

        {info && (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <DocumentPaneel
              opschrift={`${info.citeertitel || bwbId} — artikel ${info.artikel}`}
              leden={leden}
              elementen={markeerbaar}
              actiefId={actiefId}
              onKies={setActiefId}
            />
            <div>
              {persistent ? (
                <ReviewQueue
                  elementen={doc!.elementen}
                  actiefId={actiefId}
                  onKies={setActiefId}
                  onBeslissing={beslissing}
                />
              ) : (
                <div className="space-y-2">
                  {voorstellen.length === 0 && !bezig && (
                    <p className="text-sm text-muted">Nog geen voorstellen. Klik “Annoteer”.</p>
                  )}
                  {voorstellen.map((v, i) => (
                    <div key={i} className="rounded-xl border border-line bg-white p-3">
                      <span className="rounded px-2 py-0.5 text-xs font-semibold">{v.klasse}</span>
                      <p className="mt-1 text-sm text-ink">“{v.tekst}”</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
