"use client";

import { useEffect, useMemo, useState } from "react";

import { Melding } from "@/components/ui/Melding";
import { AgentIngang } from "@/components/workbench/AgentIngang";
import { DocumentLijst } from "@/components/workbench/DocumentLijst";
import { DocumentPaneel, type Markeerbaar } from "@/components/workbench/DocumentPaneel";
import { ReviewQueue } from "@/components/workbench/ReviewQueue";
import {
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
  DocumentSamenvatting,
  GraafArtikel,
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
  const [doc, setDoc] = useState<AnnotatieDocument | null>(null);
  const [info, setInfo] = useState<GraafArtikel | null>(null);
  const [status, setStatus] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [actiefId, setActiefId] = useState<string | undefined>();

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
    setStatus("");
    setFout(null);
    setActiefId(undefined);
  }

  /** De agent heeft een artikel/lid opgehaald en geannoteerd → persisteer als document + elementen. */
  async function onAgentResultaat(doel: AgentDoel, elementen: VoorstelElement[]) {
    setFout(null);
    setBezig(true);
    setStatus("Opslaan…");
    try {
      const [document, graaf] = await Promise.all([
        maakDocument({ bwbId: doel.bwbId, artikel: doel.artikel, lid: doel.lid || null }),
        haalArtikelGraaf(doel.bwbId, doel.artikel, doel.lid),
      ]);
      const bijgewerkt = await zetElementen(document.slug, elementen);
      setDoc(bijgewerkt);
      setInfo(graaf);
      setModus("open");
      setStatus(`${bijgewerkt.elementen.length} elementen voorgesteld.`);
      verversLijst();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  async function openDocument(slug: string) {
    setFout(null);
    setStatus("");
    setBezig(true);
    try {
      const document = await haalDocument(slug);
      setDoc(document);
      setModus("open");
      setInfo(await haalArtikelGraaf(document.bwbId, document.artikel, document.lid));
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

  async function beslissing(elementId: string, req: BeslissingInvoer) {
    if (!doc) return;
    try {
      setDoc(await beslis(doc.slug, elementId, req));
      verversLijst();
    } catch (e) {
      setFout(foutTekst(e));
    }
  }

  const markeerbaar: Markeerbaar[] = useMemo(
    () => (doc?.elementen ?? []).map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst })),
    [doc],
  );

  // Documenttekst uit de graaf: "N. tekst" per lid (of de kale tekst bij een ongenummerd lid).
  const leden = useMemo(() => {
    const lt = info?.leden_teksten;
    if (!lt) return [];
    return lt.map((l) => (l.lid ? `${l.lid}. ${l.tekst}` : l.tekst)).filter(Boolean);
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
        {modus === "nieuw" && <AgentIngang onResultaat={onAgentResultaat} disabled={bezig} />}

        {fout && <Melding type="fout">{fout}</Melding>}
        {status && <p className="text-sm text-muted">{status}</p>}

        {info && (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <DocumentPaneel
              opschrift={`${info.citeertitel || doc?.bwbId || ""} — artikel ${info.artikel}${doc?.lid ? ` lid ${doc.lid}` : ""}`}
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
                <p className="text-sm text-muted">Nog geen elementen.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
