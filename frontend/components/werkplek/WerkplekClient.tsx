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
  voegElementToe,
} from "@/lib/api";
import type {
  Anker,
  AnnotatieElement,
  AgentDoel,
  AgentKandidaat,
  AnnotatieDocument,
  BeslissingInvoer,
  Bron,
  GraafArtikel,
  OntbrekendItem,
  VoorstelElement,
} from "@/lib/types";
import { kandidaatLabel, kandidaatPrompt, kandidatenAlsTekst, mergeVoorstellen } from "@/lib/annotatie";
import { wettenOverheidHref } from "@/lib/url";

type Item =
  | { id: string; type: "user"; tekst: string }
  | { id: string; type: "antwoord"; tekst: string; denk?: string; bronnen?: Bron[] }
  | { id: string; type: "annotatie"; slug: string; ontbrekend?: OntbrekendItem[] }
  // De vraag noemde een onderwerp: de agent vond bepalingen, de jurist kiest er één.
  | { id: string; type: "kandidaten"; tekst: string; kandidaten: AgentKandidaat[] };

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
  // Niet-blokkerende melding als het opslaan van een beurt faalt (de chat loopt door).
  const [bewaarFout, setBewaarFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [actiefId, setActiefId] = useState<string | undefined>();
  const [artefactSlug, setArtefactSlug] = useState<string | undefined>();
  // Zichtbaarheid van de "naar beneden"-pil: aan zodra de gebruiker weg van de bodem scrolt.
  const [toonNaarBeneden, setToonNaarBeneden] = useState(false);
  const lijstRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Synchrone guard tegen dubbel-verzenden (twee Enters in dezelfde tick): de `bezig`-state komt te laat
  // — vóór de eerste `await` (maakGesprek) is die nog false, wat twee gesprekken zou aanmaken.
  const bezigRef = useRef(false);
  // "Stick-to-bottom": alleen automatisch meescrollen als de gebruiker al onderaan staat, zodat
  // omhoogscrollen tijdens het streamen niet telkens wordt teruggetrokken.
  const stickRef = useRef(true);

  // Hydrateer één keer bij mount: bestaande gespreksberichten → thread. Lees de id uit een MOUNT-vaste
  // ref, niet uit de reactieve prop: bij de eerste beurt zet de shell `activeId` (→ prop null→id) zónder
  // remount; zou de effect daarop herstarten, dan overschrijft `haalGesprek` de lopende stream. Een échte
  // gespreks-wissel remount dit component (via `key={mountKey}`), dus de ref draagt dan de juiste id.
  const hydratieId = useRef(initialGesprekId).current;
  useEffect(() => {
    if (!hydratieId) return;
    let afgebroken = false;
    haalGesprek(hydratieId)
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
  }, [hydratieId]);

  useEffect(() => {
    const el = lijstRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [items, bezig]);

  function onThreadScroll() {
    const el = lijstRef.current;
    if (!el) return;
    const bijBodem = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = bijBodem;
    setToonNaarBeneden(!bijBodem && items.length > 0); // React bail-out bij gelijke waarde
  }

  function naarBeneden() {
    const el = lijstRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setToonNaarBeneden(false);
  }

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

  /** Persisteer één beurt. Mislukken mag de chat niet blokkeren — maar ook niet stil gebeuren:
   *  de beurt staat dan wél in beeld en is na herladen weg. Eén onopvallende melding boven de thread
   *  is genoeg; per beurt een foutregel zou het gesprek onleesbaar maken. */
  async function persisteer(gid: string, rol: "user" | "assistant", velden: Record<string, unknown>) {
    try {
      await voegBerichtToe(gid, { rol, ...velden });
      setBewaarFout(null);
    } catch (e) {
      setBewaarFout(foutTekst(e));
    }
  }

  async function verstuur(vast?: string) {
    const prompt = (vast ?? invoer).trim();
    if (!prompt || bezigRef.current) return;
    bezigRef.current = true;
    setInvoer("");

    // Toon de user-bubbel + antwoord-placeholder OPTIMISTISCH, vóór het (bij een nieuw gesprek) awaiten
    // van maakGesprek — anders "verdwijnt" het bericht tijdens die round-trip.
    const antId = uid();
    setItems((xs) => [...xs, { id: uid(), type: "user", tekst: prompt }, { id: antId, type: "antwoord", tekst: "" }]);
    setBezig(true);
    stickRef.current = true; // een nieuwe beurt springt altijd naar de bodem

    // Zorg voor een gesprek-id (maak er bij de eerste beurt één aan; titel = de vraag, afgekapt).
    let gid = gesprekId;
    if (!gid) {
      try {
        const g = await maakGesprek(prompt.slice(0, 80));
        gid = g.id;
        setGesprekId(gid);
        onGesprekAangemaakt(gid);
      } catch (e) {
        updateItem(antId, { tekst: `⚠️ ${foutTekst(e)}` });
        setBezig(false);
        bezigRef.current = false;
        return;
      }
    }

    void persisteer(gid, "user", { tekst: prompt });

    const doelRef: { d: AgentDoel | null } = { d: null };
    // Ontdubbeld verzamelen: de agent kan hetzelfde element in meerdere rondes opnieuw sturen
    // (annoteerder ⇄ Critic), en dan wint de laatste versie.
    let els: VoorstelElement[] = [];
    const ontbrekend: OntbrekendItem[] = [];
    const suggesties: { element_id: string; aandacht: string; motivatie: string }[] = [];
    let kandidaten: AgentKandidaat[] = [];
    let tekst = "";
    let denk = "";
    let bronnen: Bron[] = [];
    try {
      // Markeringen die de jurist al maakte gaan mee: de Critic kan er dan een kanttekening bij
      // zetten. De agent kan niet zelf in het document kijken — dat leeft in de api.
      const reedsEigen = Object.values(docs)
        .flatMap((d) => d.elementen)
        .filter((e) => e.herkomst === "mens")
        .map((e) => ({ id: e.id, klasse: e.klasse, tekst: e.tekst, lid: e.lid, herkomst: e.herkomst }));

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
          onElement: (e) => (els = mergeVoorstellen(els, e)),
          onOntbrekend: (xs) => ontbrekend.push(...xs),
          onSuggestie: (s) => suggesties.push(s),
          onKandidaten: (k) => (kandidaten = k),
        },
        gid,
        undefined,
        reedsEigen.length ? { context: { bestaande_elementen: reedsEigen } } : undefined,
      );

      if (kandidaten.length) {
        setItems((xs) =>
          xs.map((x) => (x.id === antId ? { id: antId, type: "kandidaten", tekst, kandidaten } : x)),
        );
        // Alleen de tekst overleeft een herlaadbeurt: de kandidaten zitten niet in het
        // berichtcontract van de api. Beter een leesbare opsomming dan "ik vond 5 bepalingen".
        void persisteer(gid, "assistant", { tekst: kandidatenAlsTekst(tekst, kandidaten), denk });
        onGewijzigd();
        return;
      }

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
        const bijgewerkt = await zetElementen(document.slug, els, 0, suggesties);
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
      bezigRef.current = false;
    }
  }

  /** De jurist markeert zelf een fragment. Gooit door naar het paneel, dat de fout bij de selectie
   *  toont — daar staat de gebruiker met zijn aandacht, niet onderin de chatthread. */
  async function eigenMarkering(
    slug: string,
    invoer: { klasse: string; tekst: string; lid: string; toelichting: string; anker: Anker },
  ) {
    const oud = new Set((docs[slug]?.elementen ?? []).map((e) => e.id));
    const bij = await voegElementToe(slug, invoer);
    setDocs((m) => ({ ...m, [slug]: bij }));
    // Zet de verse markering meteen in beeld. De tekst toont alleen de geselecteerde, dus zonder dit
    // lijkt zelf markeren niets te doen: je selectie verdwijnt en er komt geen kleur voor terug.
    const nieuw = bij.elementen.find((e) => !oud.has(e.id));
    if (nieuw) setActiefId(nieuw.id);
  }

  /** Adviesvraag bij één element: `modus: "advies"` stuurt de agent naar de antwoord-route, die
   *  geen element-events uitstuurt — de annotatie kan er dus niet door wijzigen. Het paar
   *  vraag/antwoord bewaren we óók als gespreksbericht, zodat de thread één verhaal blijft. */
  async function advies(
    slug: string,
    el: AnnotatieElement,
    vraag: string,
    opToken: (t: string) => void,
  ) {
    const doc = docs[slug];
    const info = infos[slug];
    let antwoord = "";
    await annoteerAgentStream(
      vraag,
      {
        onToken: (t) => {
          antwoord += t;
          opToken(t);
        },
      },
      gesprekId ?? undefined,
      undefined,
      {
        modus: "advies",
        context: {
          slug,
          bwbId: doc?.bwbId,
          artikel: doc?.artikel,
          lid: el.lid || doc?.lid,
          element_id: el.id,
          klasse: el.klasse,
          fragment: el.tekst,
          corpus: info?.leden_teksten.map((l) => l.tekst).join("\n\n"),
        },
      },
    );
    if (gesprekId) {
      const plek = `${doc?.bwbId ?? ""} art. ${doc?.artikel ?? ""}${el.lid ? ` lid ${el.lid}` : ""}`;
      void persisteer(gesprekId, "user", { tekst: `Advies bij ${plek} — «${el.tekst}»: ${vraag}` });
      void persisteer(gesprekId, "assistant", { tekst: antwoord });
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Beknopte statusmelding voor schermlezers (niet de hele thread live maken → geen token-spam). */}
      <p className="sr-only" aria-live="polite">
        {bezig ? "Bezig met antwoorden…" : ""}
      </p>
      {bewaarFout && (
        <div role="status" className="shrink-0 border-b border-fout/30 bg-fout/10 px-4 py-2 text-center text-[0.8125rem] text-fout">
          Dit gesprek wordt op dit moment niet bewaard ({bewaarFout}). Wat je hier ziet verdwijnt bij
          het herladen.
        </div>
      )}
      {/* Thread — enige scrollende gebied; berichten in een gecentreerde leeskolom */}
      <div ref={lijstRef} onScroll={onThreadScroll} className="min-h-0 flex-1 overflow-y-auto">
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
                    className="rounded-bubbel border border-line bg-paper px-4 py-2.5 text-left text-sm text-lint shadow-zacht transition-all hover:-translate-y-0.5 hover:border-lint/40 hover:shadow-kaart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item) =>
            item.type === "user" ? (
              <div key={item.id} className="flex animate-rise justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubbel bg-lint/10 px-4 py-2.5 text-sm text-ink">
                  {item.tekst}
                </div>
              </div>
            ) : item.type === "antwoord" ? (
              <div key={item.id} className="group flex animate-rise gap-3">
                <AssistentAvatar />
                <div className="min-w-0 flex-1 text-sm text-ink">
                  <p className="mb-1 text-xs font-medium text-muted">Assistent</p>
                  {item.denk && <DenkProces tekst={item.denk} actief={bezig && !item.tekst} />}
                  {item.tekst ? <Markdown tekst={item.tekst} /> : item.denk ? null : <Punten />}
                  {item.bronnen && item.bronnen.length > 0 && <Bronnen bronnen={item.bronnen} />}
                  {item.tekst && <KopieerKnop tekst={item.tekst} />}
                </div>
              </div>
            ) : item.type === "kandidaten" ? (
              <div key={item.id} className="group flex animate-rise gap-3">
                <AssistentAvatar />
                <div className="min-w-0 flex-1 text-sm text-ink">
                  <p className="mb-1 text-xs font-medium text-muted">Assistent</p>
                  {item.tekst && <Markdown tekst={item.tekst} />}
                  <KandidatenKeuze
                    kandidaten={item.kandidaten}
                    bezig={bezig}
                    onKies={(k) => void verstuur(kandidaatPrompt(k))}
                  />
                </div>
              </div>
            ) : (
              <div key={item.id} className="animate-rise">
                <AnnotatieChip
                  doc={docs[item.slug]}
                  aantal={docs[item.slug]?.elementen.length}
                  onOpen={() => void openArtefact(item.slug)}
                />
              </div>
            ),
          )}
        </div>
      </div>

      {/* "Naar beneden"-pil: verschijnt als je weg van de bodem scrolt (bv. tijdens streamen). */}
      {toonNaarBeneden && (
        <button
          type="button"
          onClick={naarBeneden}
          aria-label="Naar nieuwste bericht"
          className="absolute bottom-24 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-paper text-lint shadow-kaart transition-colors hover:border-lint/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </button>
      )}

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
          // Nog eens op dezelfde markering klikken laat hem weer los. Selecteren zet de tekst in
          // focus (alleen die markering), dus zonder toggle zou je er niet meer uit komen.
          onKies={(id) => setActiefId((huidig) => (id && id === huidig ? undefined : id))}
          onBeslissing={(elementId, req) => beslissing(artefactSlug, elementId, req)}
          onEigenMarkering={(invoer) => eigenMarkering(artefactSlug, invoer)}
          onAdvies={(el, vraag, opToken) => advies(artefactSlug, el, vraag, opToken)}
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

/** De keuzelijst bij een onderwerp-vraag: welke bepaling gaat de werkvoorraad in?
 *
 *  Eén klik = één annotatie-opdracht. Bewust géén multi-select met "annoteer alle vijf": elke
 *  annotatie is een eigen document met een eigen review, en vijf tegelijk starten maakt de
 *  reviewlast onzichtbaar op het moment dat je hem aangaat.
 */
function KandidatenKeuze({
  kandidaten,
  bezig,
  onKies,
}: {
  kandidaten: AgentKandidaat[];
  bezig: boolean;
  onKies: (k: AgentKandidaat) => void;
}) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {kandidaten.map((k) => (
        <li key={`${k.bwbId}|${k.artikel}|${k.lid ?? ""}`}>
          <button
            type="button"
            disabled={bezig}
            onClick={() => onKies(k)}
            className="flex w-full items-center gap-3 rounded-kaart border border-line bg-surface px-4 py-3 text-left shadow-zacht transition-all hover:-translate-y-0.5 hover:border-lint/40 hover:shadow-kaart disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{kandidaatLabel(k)}</span>
              {k.fragment && <span className="mt-0.5 block line-clamp-2 text-xs text-muted">{k.fragment}</span>}
            </span>
            <span className="shrink-0 text-muted" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>
        </li>
      ))}
    </ul>
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

/** Klein avatar links van een agentantwoord (zelfde icoonstijl als de AnnotatieChip). */
function AssistentAvatar() {
  return (
    <span
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lint/10 text-lint"
      aria-hidden
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" />
        <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </svg>
    </span>
  );
}

/** Kopieert de letterlijke antwoordtekst; toont kort "Gekopieerd". Subtiel, hover-onthullend op desktop. */
function KopieerKnop({ tekst }: { tekst: string }) {
  const [gekopieerd, setGekopieerd] = useState(false);
  async function kopieer() {
    try {
      await navigator.clipboard.writeText(tekst);
      setGekopieerd(true);
      setTimeout(() => setGekopieerd(false), 1500);
    } catch {
      /* clipboard geweigerd — stil */
    }
  }
  return (
    <button
      type="button"
      onClick={kopieer}
      aria-label="Antwoord kopiëren"
      className="mt-2 inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted transition-opacity hover:text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
    >
      {gekopieerd ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Gekopieerd
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect width="14" height="14" x="8" y="8" rx="2" />
            <path d="M4 16V4a2 2 0 0 1 2-2h10" />
          </svg>
          Kopiëren
        </>
      )}
    </button>
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
