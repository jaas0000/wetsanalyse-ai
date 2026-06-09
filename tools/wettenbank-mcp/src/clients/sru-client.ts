/**
 * SRU-client voor zoekservice.overheid.nl
 * Verantwoordelijk voor HTTP-requests en XML-parsing van SRU-responses.
 */

import { DOMParser } from "@xmldom/xmldom";
import { log } from "../logger.js";

type XNode = any;

const SRU_BASE = "https://zoekservice.overheid.nl/sru/Search";
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

export function getElText(parent: XNode | null, tagName: string): string {
  if (!parent) return "";
  const el = parent.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() ?? "";
}

export function getAttr(el: XNode | null, attrName: string): string {
  if (!el) return "";
  return el.getAttribute(attrName) ?? "";
}

/**
 * Parseert XML strikt: een `fatalError` gooit xmldom zelf al; daarnaast vangen we
 * een ontbrekend `documentElement` af. Zo lekt malformed/leeg XML niet stil door
 * als een lege resultaatlijst, maar als een expliciete fout met bronvermelding.
 */
export function parseXmlDoc(xml: string, bron: string): XNode {
  let doc: XNode;
  try {
    doc = domParser.parseFromString(xml, "text/xml");
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

export async function sruRequest(query: string, maxRecords = 10): Promise<string> {
  const params = new URLSearchParams({
    operation: "searchRetrieve",
    version: "2.0",
    "x-connection": "BWB",
    query,
    maximumRecords: String(maxRecords),
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SRU_BASE}?${params}`, {
      headers: { Accept: "application/xml" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SRU HTTP ${res.status}`);
    return res.text();
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`SRU-timeout na ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseRecords(xml: string): Regeling[] {
  const doc = parseXmlDoc(xml, "SRU-service");
  const records = Array.from(doc.getElementsByTagName("record")) as XNode[];

  const geparsed = records.map((rec) => {
    const gzd = rec.getElementsByTagName("gzd")[0];
    const owmskern = gzd?.getElementsByTagName("owmskern")[0];
    const bwbipm = gzd?.getElementsByTagName("bwbipm")[0];
    const enrich = gzd?.getElementsByTagName("enrichedData")[0];

    const bwbId = getElText(owmskern, "dcterms:identifier");
    const rgEls = bwbipm ? Array.from(bwbipm.getElementsByTagName("overheidbwb:rechtsgebied")) : [];
    const rechtsgebiedStr = rgEls.map((e: XNode) => e.textContent?.trim()).filter(Boolean).join(", ");

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
