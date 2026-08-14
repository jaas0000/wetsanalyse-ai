"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ArtefactPaneel } from "@/components/werkplek/ArtefactPaneel";
import { Melding } from "@/components/ui/Melding";
import { Markdown, StreamendeTekst } from "@/components/werkplek/Markdown";
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
  verwijderElement,
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
import {
  BESLIST_LIFECYCLES, eigenMarkeringenVoorContext, kandidaatLabel, kandidaatPrompt,
  kandidatenAlsTekst, mergeVoorstellen, vraagContextLabel, vraagContextVan,
} from "@/lib/annotatie";
import { useBreedScherm } from "@/lib/useBreedScherm";
import { jasStyle } from "@/lib/jas";
import { bronHref } from "@/lib/url";

type Item =
  | { id: string; type: "user"; tekst: string; over?: string }
  | { id: string; type: "antwoord"; tekst: string; denk?: string; bronnen?: Bron[] }
  // `denk` = de tijdlijn van het samenspel (supervisor → ophaal → annoteerder ⇄ Critic). Die werd
  // eerder weggegooid zodra de beurt een annotatie bleek; juist bij een annotatie wil je achteraf
  // kunnen zien hoe hij tot stand kwam.
  | { id: string; type: "annotatie"; slug: string; ontbrekend?: OntbrekendItem[]; denk?: string }
  // De vraag noemde een onderwerp: de agent vond bepalingen, de jurist kiest er één.
  | { id: string; type: "kandidaten"; tekst: string; kandidaten: AgentKandidaat[] };

/** Wat er zojuist is vastgelegd, in één zin voor de schermlezer. */
function beslissingMelding(req: BeslissingInvoer): string {
  if (req.type === "approve") return "Akkoord bevonden.";
  if (req.type === "reject") return "Verworpen.";
  if (req.type === "comment") return "Opmerking opgeslagen.";
  const w = req.wijziging ?? {};
  if (w.klasse) return `Klasse gewijzigd naar ${w.klasse}.`;
  if (w.tekst) return `Fragment aangepast naar ${w.tekst}.`;
  if (w.toelichting !== undefined) return w.toelichting ? "Toelichting opgeslagen." : "Toelichting gewist.";
  return "Wijziging opgeslagen.";
}

/** Hoeveel elementen wachten nog op een oordeel? Zelfde regel als de reviewlijst. */
function teBeoordelen(doc: AnnotatieDocument): number {
  return doc.elementen.filter((el) => !BESLIST_LIFECYCLES.includes(el.lifecycle)).length;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Is dit een door onszelf afgebroken stream, of een echte fout? */
function isAfgebroken(e: unknown): boolean {
  return (e as Error)?.name === "AbortError";
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
  // Wat er zojuist is opgeslagen, voor schermlezers. Zonder dit gebeurt elke annotatie-wijziging
  // volledig stil: de kaart verandert visueel, maar er wordt niets aangekondigd.
  const [melding, setMelding] = useState("");
  // Waar de volgende vraag over gaat, gezet vanuit een reviewkaart. Zolang dit staat gaat de beurt
  // als adviesvraag (met contextblok) in plaats van als gewone vraag.
  const [vraagOver, setVraagOver] = useState<{ slug: string; el: AnnotatieElement } | null>(null);
  // Het artefact openen haalt document + wettekst op. Dat mag niet stil gebeuren: zonder deze twee
  // leverde een mislukte graaf-call een klik op waar lettérlijk niets van gebeurde.
  const [artefactLaadt, setArtefactLaadt] = useState<string | null>(null);
  const [artefactFout, setArtefactFout] = useState<{ slug: string; melding: string } | null>(null);
  const lijstRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Synchrone guard tegen dubbel-verzenden (twee Enters in dezelfde tick): de `bezig`-state komt te laat
  // — vóór de eerste `await` (maakGesprek) is die nog false, wat twee gesprekken zou aanmaken.
  const bezigRef = useRef(false);
  // Waarmee een lopende beurt is af te breken. Een annotatie duurt tot ~90 seconden; zonder dit is
  // een verkeerd gestelde vraag anderhalve minuut wachten.
  const afbrekenRef = useRef<AbortController | null>(null);
  // "Stick-to-bottom": alleen automatisch meescrollen als de gebruiker al onderaan staat, zodat
  // omhoogscrollen tijdens het streamen niet telkens wordt teruggetrokken.
  const stickRef = useRef(true);
  // Past het artefact naast de chat? Dan wordt het een eigen kolom in plaats van een overlay, en
  // blijft de assistent bereikbaar tijdens het reviewen.
  const breed = useBreedScherm();

  // Een lopende beurt hoort te stoppen als dit venster verdwijnt (van gesprek wisselen remount het
  // component). Zonder dit liep de SSE-verbinding — en de agent erachter — door voor een scherm dat
  // niemand meer ziet.
  useEffect(() => () => afbrekenRef.current?.abort(), []);

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
                ? { id: uid(), type: "annotatie" as const, slug: b.annotatie_slug,
                    ontbrekend: b.ontbrekend, denk: b.denk }
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
    setArtefactFout(null);
    setArtefactLaadt(slug);
    try {
      const doc = docs[slug] ?? (await laadDoc(slug));
      if (!doc) throw new Error("Het annotatiedocument is niet op te halen.");
      if (!infos[slug]) {
        const graaf = await haalArtikelGraaf(doc.bwbId, doc.artikel, doc.lid);
        setInfos((m) => ({ ...m, [slug]: graaf }));
      }
      setArtefactSlug(slug);
    } catch (e) {
      // Zichtbaar falen: de wettekst komt uit de graaf en die kan plat liggen. Een lege klik laat de
      // jurist denken dat de knop stuk is.
      setArtefactFout({ slug, melding: foutTekst(e) });
    } finally {
      setArtefactLaadt(null);
    }
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

    // Een vraag bij een markering gaat als ADVIES: dezelfde thread, maar met contextblok en langs de
    // antwoordroute — die kan topologisch geen annotatie wijzigen.
    const context = vraagOver;
    setVraagOver(null);
    const contextLabel = context ? vraagContextLabel(context.el, docs[context.slug]) : "";
    // Op een smal scherm ligt het artefact óver de chat: stap opzij zodat je het antwoord ziet komen.
    if (context && !breed) setArtefactSlug(undefined);

    // Toon de user-bubbel + antwoord-placeholder OPTIMISTISCH, vóór het (bij een nieuw gesprek) awaiten
    // van maakGesprek — anders "verdwijnt" het bericht tijdens die round-trip.
    // De controller bestaat vóórdat de knop een stopknop wordt. Stond hij verderop (na het
    // aanmaken van het gesprek), dan deed "stoppen" in dat eerste venster niets.
    const beheerser = new AbortController();
    afbrekenRef.current = beheerser;

    const antId = uid();
    setItems((xs) => [
      ...xs,
      { id: uid(), type: "user", tekst: prompt, over: contextLabel || undefined },
      { id: antId, type: "antwoord", tekst: "" },
    ]);
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

    // De chip is UI-state en reist niet mee naar de api; zonder deze regel leest een herladen gesprek
    // als een losse vraag zonder onderwerp.
    void persisteer(gid, "user", { tekst: contextLabel ? `Bij ${contextLabel}: ${prompt}` : prompt });

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
      // zetten. De agent kan niet zelf in het document kijken — dat leeft in de api. Alleen de
      // bepaling die nú open staat: de Critic beoordeelt ze tegen de tekst die hij zelf ophaalt, dus
      // markeringen uit een ander artikel kan hij daar per definitie niet in terugvinden.
      const reedsEigen = eigenMarkeringenVoorContext(artefactSlug ? docs[artefactSlug] : undefined);

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
        beheerser.signal,
        context
          ? {
              modus: "advies",
              context: vraagContextVan(context.slug, docs[context.slug], infos[context.slug], context.el),
            }
          : reedsEigen.length
            ? { context: { bestaande_elementen: reedsEigen } }
            : undefined,
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
            x.id === antId
              ? { id: antId, type: "annotatie", slug: bijgewerkt.slug, ontbrekend, denk }
              : x,
          ),
        );
        setArtefactSlug(bijgewerkt.slug); // schuif het artefact meteen in
        void persisteer(gid, "assistant", { annotatie_slug: bijgewerkt.slug, ontbrekend, denk });
      } else {
        if (!tekst.trim()) updateItem(antId, { tekst: "(geen antwoord)" });
        void persisteer(gid, "assistant", { tekst: tekst.trim() || "(geen antwoord)", denk, bronnen });
      }
      onGewijzigd();
    } catch (e) {
      // Zelf afgebroken is geen fout: bewaar wat er al stond, gemarkeerd als afgebroken. Weggooien
      // wat de agent al schreef is niet wat "stop" betekent.
      if (isAfgebroken(e)) {
        const bewaard = `${tekst.trim()}${tekst.trim() ? "\n\n" : ""}_(afgebroken)_`;
        updateItem(antId, { tekst: bewaard });
        void persisteer(gid, "assistant", { tekst: bewaard, denk, bronnen });
      } else {
        updateItem(antId, { tekst: `⚠️ ${foutTekst(e)}` });
      }
    } finally {
      afbrekenRef.current = null;
      setBezig(false);
      bezigRef.current = false;
    }
  }

  /** Breek de lopende beurt af. De `finally` hierboven bewaart wat er al binnen was. */
  function stop() {
    afbrekenRef.current?.abort();
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
    setMelding(`Gemarkeerd als ${invoer.klasse}.`);
    // Zet de verse markering meteen in beeld. De tekst toont alleen de geselecteerde, dus zonder dit
    // lijkt zelf markeren niets te doen: je selectie verdwijnt en er komt geen kleur voor terug.
    const nieuw = bij.elementen.find((e) => !oud.has(e.id));
    if (nieuw) setActiefId(nieuw.id);
  }

  /** Een eigen markering wissen. Alleen je eigen: een agent-voorstel verwérp je, zodat het
   *  auditspoor laat zien dát er een voorstel was. Was hij actief, dan valt de focus terug op de
   *  hele tekst — anders wijst `actiefId` naar een element dat niet meer bestaat. */
  async function wisEigenMarkering(slug: string, elementId: string) {
    await verwijderElement(slug, elementId);
    setDocs((m) => {
      const doc = m[slug];
      if (!doc) return m;
      return { ...m, [slug]: { ...doc, elementen: doc.elementen.filter((e) => e.id !== elementId) } };
    });
    setActiefId((huidig) => (huidig === elementId ? undefined : huidig));
    setMelding("Markering gewist.");
  }

  async function beslissing(slug: string, elementId: string, req: BeslissingInvoer) {
    try {
      const bij = await beslis(slug, elementId, req);
      setDocs((m) => ({ ...m, [slug]: bij }));
      setMelding(beslissingMelding(req));
    } catch (e) {
      // Doorgooien: het artefact toont de fout bij de kaart waar hij ontstond. In de chatthread zou
      // hij het gesprek vervuilen met techniek, ver van de plek waar je aan het werk bent.
      throw e;
    }
  }

  function opToets(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing`: met een IME (of een Android-toetsenbord dat een woordsuggestie met Enter
    // bevestigt) hoort Enter de compositie af te ronden, niet de beurt te versturen.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void verstuur();
    }
  }

  // De laatste annotatie in dit gesprek: die hoort altijd één klik weg te zijn.
  const laatsteAnnotatie = [...items].reverse().find((x) => x.type === "annotatie")?.slug;

  const artefact = artefactSlug && docs[artefactSlug] && infos[artefactSlug] && (
    <ArtefactPaneel
      variant={breed ? "kolom" : "side"}
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
      onWisEigenMarkering={(elementId) => wisEigenMarkering(artefactSlug, elementId)}
      onVraag={(el) => {
        setVraagOver({ slug: artefactSlug, el });
        taRef.current?.focus();
      }}
      onSluit={() => setArtefactSlug(undefined)}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Beknopte statusmelding voor schermlezers (niet de hele thread live maken → geen token-spam). */}
      <p className="sr-only" aria-live="polite">
        {bezig ? "Bezig met antwoorden…" : melding}
      </p>
      {/* De annotatie blijft bereikbaar. De chip in de thread scrolt weg zodra het gesprek doorloopt;
          dan is er geen weg terug naar het werk waar je middenin zat. */}
      {!artefactSlug && laatsteAnnotatie && docs[laatsteAnnotatie] && (
        <button
          type="button"
          onClick={() => void openArtefact(laatsteAnnotatie)}
          disabled={artefactLaadt === laatsteAnnotatie}
          className="focus-ring flex w-full shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2 text-left text-xs text-muted transition hover:bg-surface-2 disabled:opacity-60"
        >
          <span className="truncate">
            <span className="font-medium text-ink">
              {docs[laatsteAnnotatie].werkgebied || docs[laatsteAnnotatie].bwbId} — art.{" "}
              {docs[laatsteAnnotatie].artikel}
            </span>{" "}
            · {docs[laatsteAnnotatie].elementen.length} elementen
            {teBeoordelen(docs[laatsteAnnotatie]) > 0 && ` · ${teBeoordelen(docs[laatsteAnnotatie])} te beoordelen`}
          </span>
          <span className="ml-auto shrink-0 font-medium text-lint">
            {artefactLaadt === laatsteAnnotatie ? "Openen…" : "Openen"}
          </span>
        </button>
      )}

      {artefactFout && (
        <div className="shrink-0 px-4 pt-2">
          <Melding type="fout" compact>
            De annotatie kon niet worden geopend ({artefactFout.melding}).{" "}
            <button
              type="button"
              onClick={() => void openArtefact(artefactFout.slug)}
              className="focus-ring rounded font-medium underline underline-offset-2"
            >
              Opnieuw proberen
            </button>
          </Melding>
        </div>
      )}

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

          {items.map((item, i) => {
            // Alleen de laatste beurt kan aan het streamen zijn; die krijgt platte tekst tot hij
            // klaar is (zie `StreamendeTekst`).
            const streamt = bezig && i === items.length - 1;
            return item.type === "user" ? (
              <div key={item.id} className="flex animate-rise flex-col items-end gap-1">
                {item.over && (
                  <span className="max-w-[85%] truncate rounded-full bg-surface px-2.5 py-0.5 text-[0.7rem] text-muted">
                    bij {item.over}
                  </span>
                )}
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
                  {item.tekst ? (
                    streamt ? <StreamendeTekst tekst={item.tekst} /> : <Markdown tekst={item.tekst} />
                  ) : item.denk ? null : (
                    <Punten />
                  )}
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
                {item.denk && <DenkProces tekst={item.denk} actief={false} label="Zo is dit tot stand gekomen" />}
                <AnnotatieChip
                  doc={docs[item.slug]}
                  aantal={docs[item.slug]?.elementen.length}
                  onOpen={() => void openArtefact(item.slug)}
                />
              </div>
            );
          })}
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
          {/* Waar de volgende vraag over gaat. Zichtbaar zolang hij geldt, want anders stel je
              ongemerkt een adviesvraag over een element dat je allang niet meer voor je hebt. */}
          {vraagOver && (
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-lint/30 bg-lint/5 px-2.5 py-1 text-xs text-lint">
                <span className={`shrink-0 rounded px-1 text-[0.7rem] ${jasStyle(vraagOver.el.klasse)}`}>
                  {vraagOver.el.klasse}
                </span>
                <span className="truncate">“{vraagOver.el.tekst}”</span>
                <button
                  type="button"
                  onClick={() => setVraagOver(null)}
                  aria-label="Vraag niet aan dit element koppelen"
                  className="focus-ring shrink-0 rounded-full p-0.5 hover:bg-lint/10"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-bubbel border border-line bg-white px-2 py-1.5 shadow-zacht transition-shadow focus-within:border-lint focus-within:shadow-kaart">
            <textarea
              ref={taRef}
              value={invoer}
              onChange={(e) => setInvoer(e.target.value)}
              onKeyDown={opToets}
              rows={1}
              placeholder={vraagOver ? "Wat wil je weten over deze markering?" : "Stel een vraag of vraag een annotatie…"}
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink placeholder:text-faint focus:outline-none"
            />
            {/* Tijdens het antwoorden is dit de stopknop: hetzelfde plekje, andere betekenis — je hoeft
                niet te zoeken waar je moet klikken om te onderbreken. */}
            <button
              type="button"
              onClick={() => (bezig ? stop() : verstuur())}
              disabled={!bezig && !invoer.trim()}
              aria-label={bezig ? "Stoppen" : "Versturen"}
              className="focus-ring mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-paper transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bezig ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
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

      {/* Op een smal scherm schuift het artefact als overlay over de chat heen. */}
      {!breed && artefact}
    </div>

    {/* Op een breed scherm staat het ernaast: chat en review tegelijk in beeld. */}
    {breed && artefact && (
      <div className="hidden w-[min(34rem,42vw)] shrink-0 xl:block">{artefact}</div>
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
  // De "Gekopieerd"-melding weer weghalen, en de timer opruimen als het bericht ondertussen
  // verdwijnt (bv. bij het wisselen van gesprek).
  useEffect(() => {
    if (!gekopieerd) return;
    const id = window.setTimeout(() => setGekopieerd(false), 1500);
    return () => window.clearTimeout(id);
  }, [gekopieerd]);

  async function kopieer() {
    try {
      await navigator.clipboard.writeText(tekst);
      setGekopieerd(true);
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
function DenkProces({
  tekst,
  actief,
  label = "Denkproces",
}: {
  tekst: string;
  actief: boolean;
  /** Bij een annotatie is dit geen "denkproces" maar het spoor van het samenspel tussen de agents. */
  label?: string;
}) {
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
        <span>{actief ? "Denkt na…" : label}</span>
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
            const href = bronHref(b.uri);
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
