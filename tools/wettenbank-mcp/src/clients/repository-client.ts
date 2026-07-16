/**
 * Repository-client voor officiele-overheidspublicaties.nl
 * Haalt BWB-wetstekst XML op, beheert in-memory cache en extraheert doc-metadata.
 */

import {
  sruRequest,
  parseRecords,
  parseXmlDoc,
  getElText,
  getAttr,
  isVertrouwdeRepoUrl,
} from "./sru-client.js";
import type { Regeling } from "./sru-client.js";
import { fetchTekstMetRetry } from "./http.js";
import { UpstreamError } from "../shared/fouten.js";
import { vandaag } from "../shared/utils.js";
import { log } from "../logger.js";
import { telCacheToegang } from "../otel.js";
import type { DomDocument, DomElement, DomNode } from "../shared/dom.js";

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  rawXml: string;
  doc: DomDocument;
  regeling: Regeling;
  timestamp: number;
  bytes: number;
}

// Sleutel = toestand-URL (locatie_toestand). Verschillende peildata die naar dezelfde
// toestand wijzen, delen zo één entry; `datumAlias` vertaalt `${bwbId}|${datum}` naar
// die URL zodat een cache-hit géén SRU-roundtrip meer kost.
export const xmlCache = new Map<string, CacheEntry>();
const datumAlias = new Map<string, string>();
const CACHE_TTL = 1000 * 60 * 60; // 1 uur
// Bovengrens op het aantal entries; naast de TTL voorkomt dit onbegrensde groei binnen
// één uur bij veel verschillende toestanden (LRU-evictie).
const MAX_CACHE_ENTRIES = 50;
// Totaalbudget (bytes rauwe XML) i.p.v. een per-entry-cap: zo worden juist de duurste
// documenten (Omgevingswet, complete wetboeken) wél gecachet — herhaald downloaden en
// parsen daarvan is veel kostbaarder dan het geheugen — terwijl het totaal begrensd
// blijft. LRU-evictie maakt ruimte tot het nieuwe document past.
const MAX_CACHE_BYTES = Number(process.env.WETTENBANK_CACHE_MAX_BYTES ?? 64 * 1024 * 1024);

/** Som van de entry-groottes; max. 50 entries dus goedkoop, en altijd in sync
 *  (ook als een test of aanroeper de Map rechtstreeks leegt). */
function totaalCacheBytes(): number {
  let som = 0;
  for (const entry of xmlCache.values()) som += entry.bytes;
  return som;
}

// Verwijder verlopen entries elk uur zodat de cache niet onbegrensd groeit.
setInterval(() => {
  const nu = Date.now();
  for (const [key, entry] of xmlCache) {
    if (nu - entry.timestamp > CACHE_TTL) xmlCache.delete(key);
  }
  // Aliassen die naar een verdwenen entry wijzen, kunnen weg.
  for (const [alias, url] of datumAlias) {
    if (!xmlCache.has(url)) datumAlias.delete(alias);
  }
}, CACHE_TTL).unref();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WetstekstResultaat {
  rawXml: string;
  doc: DomDocument;
  regeling: Regeling;
}

export interface DocMetadata {
  citeertitel: string;
  versiedatum: string;
}

// ── Functies ──────────────────────────────────────────────────────────────────

/** Cache-hit afhandelen: LRU-positie verversen en alias registreren. */
function cacheHit(url: string, entry: CacheEntry, aliasKey: string): WetstekstResultaat {
  xmlCache.delete(url);
  xmlCache.set(url, entry);
  datumAlias.set(aliasKey, url);
  telCacheToegang(true);
  return { rawXml: entry.rawXml, doc: entry.doc, regeling: entry.regeling };
}

export async function haalWetstekstOp(
  bwbId: string,
  peildatum?: string,
  signaal?: AbortSignal
): Promise<WetstekstResultaat> {
  const datum = peildatum ?? vandaag();
  const aliasKey = `${bwbId}|${datum}`;

  // Snelle route: deze bwbId+datum is al eerder naar een toestand-URL vertaald.
  const bekendeUrl = datumAlias.get(aliasKey);
  if (bekendeUrl) {
    const cached = xmlCache.get(bekendeUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cacheHit(bekendeUrl, cached, aliasKey);
    }
  }

  const sruXml = await sruRequest(
    `dcterms.identifier==${bwbId} and overheidbwb.geldigheidsdatum==${datum}`,
    1,
    signaal
  );
  const lijst = parseRecords(sruXml);
  if (!lijst.length) {
    throw new Error(`Geen regeling gevonden voor BWB-id: ${bwbId} op datum ${datum}.`);
  }
  const r = lijst[0];

  // SSRF-vangnet (defence-in-depth): parseRecords filtert al, maar we fetchen hier
  // rechtstreeks, dus weigeren we expliciet elke niet-vertrouwde repository-URL.
  if (!isVertrouwdeRepoUrl(r.repositoryUrl)) {
    throw new Error(`Niet-vertrouwde wetstekst-URL geweigerd voor BWB-id: ${bwbId}.`);
  }

  // Tweede cache-kans: een andere peildatum kan naar exact dezelfde toestand wijzen;
  // dan is alleen de (goedkope) SRU-lookup nodig en vervalt download + DOM-parse.
  const cachedToestand = xmlCache.get(r.repositoryUrl);
  if (cachedToestand && Date.now() - cachedToestand.timestamp < CACHE_TTL) {
    return cacheHit(r.repositoryUrl, cachedToestand, aliasKey);
  }

  telCacheToegang(false);
  const resp = await fetchTekstMetRetry(
    r.repositoryUrl,
    {},
    { timeoutMs: 15_000, bron: "Wetstekst-repository", signal: signaal }
  );
  if (!resp.ok)
    throw new UpstreamError(`Wetstekst repository onbereikbaar: ${resp.status}`, {
      bron: "Wetstekst-repository",
      url: r.repositoryUrl,
      httpStatus: resp.status,
    });

  const rawXml = resp.tekst;
  const doc = parseXmlDoc(rawXml, "wetstekst-repository");

  const result = { rawXml, doc, regeling: r };
  const bytes = Buffer.byteLength(rawXml);

  if (bytes > MAX_CACHE_BYTES) {
    // Past zelfs in een lege cache niet binnen het budget.
    log("warn", "functioneel", "wetstekst te groot voor cache — wordt niet gecacht", {
      bwbId,
      bytes,
    });
    return result;
  }

  // LRU-evictie tot de nieuwe entry binnen entry- én bytebudget past.
  while (
    xmlCache.size >= MAX_CACHE_ENTRIES ||
    (xmlCache.size > 0 && totaalCacheBytes() + bytes > MAX_CACHE_BYTES)
  ) {
    const oudste = xmlCache.keys().next().value;
    if (oudste === undefined) break;
    xmlCache.delete(oudste);
  }

  xmlCache.set(r.repositoryUrl, { ...result, timestamp: Date.now(), bytes });
  datumAlias.set(aliasKey, r.repositoryUrl);

  return result;
}

export function extraheerDocMetadata(doc: DomDocument): DocMetadata {
  const toestand = doc.getElementsByTagName("toestand")[0];
  const versiedatum = toestand ? getAttr(toestand, "inwerkingtredingsdatum") : "";
  const regelingInfo = doc.getElementsByTagName("regeling-info")[0];
  const citeertitel = regelingInfo ? getElText(regelingInfo, "citeertitel") : "";
  return { citeertitel, versiedatum };
}

// Tags die structurele containers vormen (directe ancestors in het hiërarchisch pad).
// circulaire.divisie hoort erbij zodat een omvattende Leidraad-bepaling (bijv. "Artikel 9")
// als pad-segment voor zijn sub-divisies (9.1, 9.1.1) meetelt.
const CONTAINER_TAGS_DOM = new Set([
  "boek", "deel", "hoofdstuk", "titel", "afdeling", "paragraaf", "subparagraaf",
  "circulaire-tekst", "circulaire.divisie",
]);

/** Eerste direct kind-element met deze tagnaam (geen descendant-zoektocht). */
function directKind(el: DomElement, tagName: string): DomElement | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);
    if (child.nodeType === 1 && (child as DomElement).tagName === tagName) {
      return child as DomElement;
    }
  }
  return null;
}

/**
 * Extraheert het leesbare label van een container-element via zijn DIRECTE kind-<kop>.
 * Een descendant-zoektocht (getElementsByTagName) zou voor een container zonder eigen
 * kop (zoals <circulaire-tekst>) de kop van de eerste diepere bepaling oppakken en zo
 * een verkeerde ouder in het pad zetten.
 */
function bouwContainerLabel(el: DomElement): string | null {
  const kop = directKind(el, "kop");
  if (!kop) return null;
  const label = getElText(kop, "label");
  const nr    = getElText(kop, "nr");
  const titel = getElText(kop, "titel");
  return [label, nr, titel].filter(Boolean).join(" ") || null;
}

export interface ArtikelTreffer {
  element: DomElement;
  containerPad: string[];
}

/** Normaliseert een artikelnummer voor vergelijking: trim + lowercase ("9A " ≡ "9a"). */
function normaliseerNr(nr: string): string {
  return nr.trim().toLowerCase();
}

/**
 * Zoekt álle artikel-elementen met dit nummer (case-insensitief, getrimd) en geeft
 * per treffer het element plus het container-pad (bijv. ["Hoofdstuk V", "Afdeling 5.1"]).
 * Meerdere treffers komen voor wanneer een bijlage dezelfde nummering herstart; de
 * aanroeper kan daar dan expliciet voor waarschuwen i.p.v. stil de eerste te nemen.
 */
export function zoekArtikelElementen(
  el: DomNode,
  artikelnummer: string,
  huidigPad: string[] = [],
  treffers: ArtikelTreffer[] = [],
): ArtikelTreffer[] {
  if (el.nodeType !== 1) return treffers;
  const elem = el as DomElement;
  const tag = elem.tagName;

  if (tag === "artikel" || tag === "circulaire.divisie") {
    // Direct kind-<kop>: bij een geneste circulaire.divisie zou een descendant-query
    // de kop van een sub-divisie kunnen oppakken en zo het verkeerde nummer matchen.
    const nr = getElText(directKind(elem, "kop"), "nr");
    if (normaliseerNr(nr) === normaliseerNr(artikelnummer)) {
      treffers.push({ element: elem, containerPad: huidigPad });
    }
  }

  const label = CONTAINER_TAGS_DOM.has(tag) ? bouwContainerLabel(elem) : null;
  const nieuwPad = label ? [...huidigPad, label] : huidigPad;

  for (let i = 0; i < elem.childNodes.length; i++) {
    zoekArtikelElementen(elem.childNodes.item(i), artikelnummer, nieuwPad, treffers);
  }
  return treffers;
}

/**
 * Eerste treffer (element + pad), of null. Bestaat naast zoekArtikelElementen voor
 * aanroepers die geen duplicaat-detectie nodig hebben.
 */
export function zoekPadEnElementInDom(
  el: DomNode,
  artikelnummer: string,
): ArtikelTreffer | null {
  return zoekArtikelElementen(el, artikelnummer)[0] ?? null;
}

export function zoekElementInDom(el: DomNode, artikelnummer: string): DomElement | null {
  return zoekPadEnElementInDom(el, artikelnummer)?.element ?? null;
}

/** Alle artikelnummers in documentvolgorde — voor foutmeldingen/suggesties. */
export function verzamelArtikelnummers(el: DomNode): string[] {
  const nummers: string[] = [];
  (function loop(node: DomNode): void {
    if (node.nodeType !== 1) return;
    const elem = node as DomElement;
    if (elem.tagName === "artikel" || elem.tagName === "circulaire.divisie") {
      const nr = getElText(directKind(elem, "kop"), "nr");
      if (nr) nummers.push(nr);
    }
    for (let i = 0; i < elem.childNodes.length; i++) loop(elem.childNodes.item(i));
  })(el);
  return nummers;
}

// Nummering-/kopelementen horen niet in de zoektekst: een los lidnummer ("1") zou
// als zoekbaar woord meetellen en, erger, aan de tekst van het volgende element
// vastplakken.
const SKIP_TAGS_VOOR_ZOEK = new Set(["kop", "nr", "lidnr", "li.nr"]);

export function extractTextForSearch(el: DomNode): string {
  if (el.nodeType === 3) return el.nodeValue ?? "";
  if (el.nodeType !== 1) return "";
  const elem = el as DomElement;
  if (SKIP_TAGS_VOOR_ZOEK.has(elem.tagName)) return "";

  // Scheid de tekst van aangrenzende kinderen met een spatie, zodat er een
  // woordgrens (\b) ontstaat tussen bv. twee <al>'s of een <lidnr> en het
  // volgende <al>. Zonder scheiding fuseert "…eerste lid" + "geldt…" tot
  // "lidgeldt" en mist een woordgebonden zoekterm de treffer.
  let text = "";
  for (let i = 0; i < elem.childNodes.length; i++) {
    text += extractTextForSearch(elem.childNodes.item(i)) + " ";
  }
  return text;
}
