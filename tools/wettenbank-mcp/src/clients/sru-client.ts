/**
 * SRU-client voor zoekservice.overheid.nl
 * Verantwoordelijk voor HTTP-requests en XML-parsing van SRU-responses.
 */

import { DOMParser } from "@xmldom/xmldom";
import { log } from "../logger.js";
import { UpstreamError } from "../shared/fouten.js";
import { fetchTekstMetRetry } from "./http.js";
import type { DomDocument, DomElement } from "../shared/dom.js";

export const SRU_BASE = "https://zoekservice.overheid.nl/sru/Search";
export const REPO_BASE = "https://repository.officiele-overheidspublicaties.nl/bwb";
const REPO_HOST = "repository.officiele-overheidspublicaties.nl";

export const domParser = new DOMParser();

/**
 * Beveiliging (SSRF): de `repositoryUrl` komt uit de SRU-respons
 * (`overheidbwb:locatie_toestand`) en is dus door de bron bepaald. We fetchen die
 * URL later rechtstreeks, dus accepteren we alleen `https:` naar de bekende
 * repository-host. Niet-vertrouwde waarden vallen terug op een zelf-geconstrueerde URL.
 */
export function isVertrouwdeRepoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === REPO_HOST;
  } catch {
    return false;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Regeling {
  bwbId: string;
  titel: string;
  type: string;
  ministerie: string;
  rechtsgebied: string;
  geldigVanaf: string;
  geldigTot: string;
  gewijzigd: string;
  repositoryUrl: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Eerste element met deze (eventueel gekwalificeerde) tagnaam; valt terug op een
 * namespace-onafhankelijke match op de lokale naam. Zo blijven de WTI-velden
 * vindbaar als de SRU-server ooit een ander prefix kiest (semantisch identieke
 * XML zou anders alle records wegfilteren).
 */
export function eersteMetTag(
  parent: DomElement | DomDocument,
  tagName: string
): DomElement | null {
  const direct = parent.getElementsByTagName(tagName).item(0);
  if (direct) return direct;
  const lokaal = tagName.includes(":") ? tagName.slice(tagName.indexOf(":") + 1) : tagName;
  return parent.getElementsByTagNameNS?.("*", lokaal)?.item(0) ?? null;
}

/** Alle elementen met deze tagnaam, met dezelfde namespace-fallback als eersteMetTag. */
export function alleMetTag(
  parent: DomElement | DomDocument,
  tagName: string
): DomElement[] {
  const direct = Array.from(parent.getElementsByTagName(tagName));
  if (direct.length > 0) return direct;
  const lokaal = tagName.includes(":") ? tagName.slice(tagName.indexOf(":") + 1) : tagName;
  const ns = parent.getElementsByTagNameNS?.("*", lokaal);
  return ns ? Array.from(ns) : [];
}

export function getElText(
  parent: DomElement | DomDocument | null,
  tagName: string
): string {
  if (!parent) return "";
  const el = eersteMetTag(parent, tagName);
  return el?.textContent?.trim() ?? "";
}

export function getAttr(el: DomElement | null, attrName: string): string {
  if (!el) return "";
  return el.getAttribute(attrName) ?? "";
}

/**
 * Parseert XML strikt: een `fatalError` gooit xmldom zelf al; daarnaast vangen we
 * een ontbrekend `documentElement` af. Zo lekt malformed/leeg XML niet stil door
 * als een lege resultaatlijst, maar als een expliciete fout met bronvermelding.
 */
export function parseXmlDoc(xml: string, bron: string): DomDocument {
  let doc: DomDocument;
  try {
    doc = domParser.parseFromString(xml, "text/xml") as unknown as DomDocument;
  } catch (err) {
    throw new Error(`Ongeldige XML van ${bron}: ${(err as Error).message}`);
  }
  if (!doc || !doc.documentElement) {
    throw new Error(`Ongeldige of lege XML-respons van ${bron}`);
  }
  return doc;
}

// ── SRU client ───────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

export async function sruRequest(
  query: string,
  maxRecords = 10,
  signaal?: AbortSignal
): Promise<string> {
  const params = new URLSearchParams({
    operation: "searchRetrieve",
    version: "2.0",
    "x-connection": "BWB",
    query,
    maximumRecords: String(maxRecords),
  });
  const res = await fetchTekstMetRetry(
    `${SRU_BASE}?${params}`,
    { headers: { Accept: "application/xml" } },
    { timeoutMs: FETCH_TIMEOUT_MS, bron: "SRU", signal: signaal }
  );
  if (!res.ok)
    throw new UpstreamError(`SRU HTTP ${res.status}`, {
      bron: "SRU",
      url: SRU_BASE,
      httpStatus: res.status,
    });
  return res.tekst;
}

/**
 * Snelle bereikbaarheidscheck van de upstream-hosts voor `/ready`. Elke HTTP-respons
 * (ook 3xx/4xx) telt als bereikbaar; alleen een netwerk-/TLS-fout betekent "down".
 * Korte timeout, géén retry — dit is een readiness-probe, geen tool-call.
 */
async function bereikbaar(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function upstreamStatus(timeoutMs = 3000): Promise<{ sru: boolean; repository: boolean }> {
  const [sru, repository] = await Promise.all([
    bereikbaar(`${SRU_BASE}?operation=explain&version=2.0`, timeoutMs),
    bereikbaar(`${REPO_BASE}/`, timeoutMs),
  ]);
  return { sru, repository };
}

/**
 * Totaal aantal treffers bij de bron (SRU `numberOfRecords`), of null als het
 * element ontbreekt. Hiermee kan de zoek-tool melden dat een resultaat is
 * afgekapt in plaats van een misleidend "totaal".
 */
export function parseAantalRecords(xml: string): number | null {
  const doc = parseXmlDoc(xml, "SRU-service");
  const el = eersteMetTag(doc, "numberOfRecords");
  if (!el) return null;
  const n = parseInt(el.textContent?.trim() ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

export function parseRecords(xml: string): Regeling[] {
  const doc = parseXmlDoc(xml, "SRU-service");
  const records = alleMetTag(doc, "record");

  const geparsed = records.map((rec) => {
    const gzd = eersteMetTag(rec, "gzd");
    const owmskern = gzd ? eersteMetTag(gzd, "owmskern") : null;
    const bwbipm = gzd ? eersteMetTag(gzd, "bwbipm") : null;
    const enrich = gzd ? eersteMetTag(gzd, "enrichedData") : null;

    const bwbId = getElText(owmskern, "dcterms:identifier");
    const rgEls = bwbipm ? alleMetTag(bwbipm, "overheidbwb:rechtsgebied") : [];
    const rechtsgebiedStr = rgEls.map((e) => e.textContent?.trim()).filter(Boolean).join(", ");

    // SSRF-mitigatie: vertrouw de bron-URL alleen als hij naar de bekende repository wijst;
    // anders een zelf-geconstrueerde URL gebruiken (vaste host, geen door de bron gestuurd doel).
    const bronUrl = getElText(enrich, "overheidbwb:locatie_toestand");
    const repositoryUrl =
      bronUrl && isVertrouwdeRepoUrl(bronUrl) ? bronUrl : `${REPO_BASE}/${bwbId}/`;

    return {
      bwbId,
      titel: getElText(owmskern, "dcterms:title"),
      type: getElText(owmskern, "dcterms:type"),
      ministerie: getElText(owmskern, "overheid:authority"),
      rechtsgebied: rechtsgebiedStr,
      geldigVanaf: getElText(bwbipm, "overheidbwb:geldigheidsperiode_startdatum"),
      geldigTot: getElText(bwbipm, "overheidbwb:geldigheidsperiode_einddatum") || "onbepaald",
      gewijzigd: getElText(owmskern, "dcterms:modified"),
      repositoryUrl,
    };
  });

  // Records zonder bwbId óf titel zijn onbruikbaar (bv. ontbrekend <gzd>): weglaten i.p.v.
  // stil lege velden teruggeven, en het aantal overgeslagen records zichtbaar maken.
  const volledig = geparsed.filter((r) => r.bwbId && r.titel);
  if (volledig.length < geparsed.length) {
    log("warn", "functioneel", "onvolledige SRU-records overgeslagen", {
      overgeslagen: geparsed.length - volledig.length,
      totaal: geparsed.length,
    });
  }
  return volledig;
}

export function dedupliceerOpBwbId(lijst: Regeling[]): Regeling[] {
  const map = new Map<string, Regeling>();
  for (const r of lijst) {
    const bestaande = map.get(r.bwbId);
    if (!bestaande || r.geldigVanaf > bestaande.geldigVanaf) {
      map.set(r.bwbId, r);
    }
  }
  return Array.from(map.values());
}
