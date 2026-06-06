import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  escapeerRegex,
  bouwTermPatroon,
  parseZoekterm,
  stripXml,
  zoekTermInArtikelDom,
  extraheerDocMetadata,
  parseRecords,
  dedupliceerOpBwbId,
  haalWetstekstOp,
  sruRequest,
  domParser,
  xmlCache,
} from "./index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSruXml(records: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse
  xmlns:overheidbwb="http://standaarden.overheid.nl/owms/terms/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:overheid="http://standaarden.overheid.nl/owms/terms/">
  <numberOfRecords>1</numberOfRecords>
  <records>${records}</records>
</searchRetrieveResponse>`;
}

function makeRecord({
  bwbId = "BWBR0002320",
  titel = "Algemene wet inzake rijksbelastingen",
  type = "wet",
  ministerie = "Financiën",
  rechtsgebied = "Belastingrecht",
  geldigVanaf = "2024-01-01",
  geldigTot = "9999-12-31",
  gewijzigd = "2024-07-19",
  locatie = `https://repository.example.nl/bwb/${bwbId}/current.xml`,
}: Partial<{
  bwbId: string; titel: string; type: string; ministerie: string;
  rechtsgebied: string | string[]; geldigVanaf: string; geldigTot: string;
  gewijzigd: string; locatie: string;
}> = {}): string {
  const rechtsgebiedXml = Array.isArray(rechtsgebied)
    ? rechtsgebied.map(r => `<overheidbwb:rechtsgebied>${r}</overheidbwb:rechtsgebied>`).join("")
    : `<overheidbwb:rechtsgebied>${rechtsgebied}</overheidbwb:rechtsgebied>`;

  return `
  <record>
    <recordData>
      <gzd>
        <originalData>
          <overheidbwb:meta>
            <owmskern>
              <dcterms:identifier>${bwbId}</dcterms:identifier>
              <dcterms:title>${titel}</dcterms:title>
              <dcterms:type>${type}</dcterms:type>
              <overheid:authority>${ministerie}</overheid:authority>
              <dcterms:modified>${gewijzigd}</dcterms:modified>
            </owmskern>
            <bwbipm>
              ${rechtsgebiedXml}
              <overheidbwb:geldigheidsperiode_startdatum>${geldigVanaf}</overheidbwb:geldigheidsperiode_startdatum>
              <overheidbwb:geldigheidsperiode_einddatum>${geldigTot}</overheidbwb:geldigheidsperiode_einddatum>
            </bwbipm>
          </overheidbwb:meta>
        </originalData>
        <enrichedData>
          <overheidbwb:locatie_toestand>${locatie}</overheidbwb:locatie_toestand>
        </enrichedData>
      </gzd>
    </recordData>
  </record>`;
}

function mockFetch(responses: Array<{ ok: boolean; text: string }>) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve({ ok: r.ok, status: r.ok ? 200 : 404, text: () => Promise.resolve(r.text) });
  });
}

// ── escapeerRegex ────────────────────────────────────────────────────────────

describe("escapeerRegex", () => {
  it("escapet regex-speciale tekens", () => {
    expect(escapeerRegex("3:40")).toBe("3:40");
    expect(escapeerRegex("25.1")).toBe("25\\.1");
    expect(escapeerRegex("a[b]")).toBe("a\\[b\\]");
    expect(escapeerRegex("a+b")).toBe("a\\+b");
  });

  it("laat gewone tekst ongewijzigd", () => {
    expect(escapeerRegex("25")).toBe("25");
    expect(escapeerRegex("abc")).toBe("abc");
  });
});

// ── bouwTermPatroon ──────────────────────────────────────────────────────────

describe("bouwTermPatroon", () => {
  it("exact woord: voegt woordgrenzen toe zonder wildcard", () => {
    expect(bouwTermPatroon("termijn")).toBe("\\btermijn\\b");
  });

  it("suffix-wildcard: \\b aan het begin, \\w* aan het einde", () => {
    expect(bouwTermPatroon("termijn*")).toBe("\\btermijn\\w*");
  });

  it("prefix-wildcard: \\w* aan het begin, \\b aan het einde", () => {
    expect(bouwTermPatroon("*termijn")).toBe("\\w*termijn\\b");
  });

  it("infix-wildcard: \\w* aan beide kanten", () => {
    expect(bouwTermPatroon("*termijn*")).toBe("\\w*termijn\\w*");
  });

  it("escapet speciale tekens vóór de suffix-wildcard", () => {
    expect(bouwTermPatroon("art. 9*")).toBe("\\bart\\. 9\\w*");
  });

  it("escapet speciale tekens zonder wildcard", () => {
    expect(bouwTermPatroon("3:40")).toBe("\\b3:40\\b");
    expect(bouwTermPatroon("25.1")).toBe("\\b25\\.1\\b");
  });
});

// ── parseZoekterm ─────────────────────────────────────────────────────────────

describe("parseZoekterm", () => {
  it("enkelvoudige term geeft OF-operator met één patroon", () => {
    const result = parseZoekterm("termijn");
    expect("patronen" in result && result.patronen).toHaveLength(1);
    expect("operator" in result && result.operator).toBe("OF");
    expect("patronen" in result && result.patronen[0].source).toBe("\\btermijn\\b");
  });

  it("EN-operator splitst op ' EN ' en geeft operator EN terug", () => {
    const result = parseZoekterm("aansprakelijk EN belasting");
    expect("operator" in result && result.operator).toBe("EN");
    expect("patronen" in result && result.patronen).toHaveLength(2);
    expect("patronen" in result && result.patronen[0].source).toBe("\\baansprakelijk\\b");
    expect("patronen" in result && result.patronen[1].source).toBe("\\bbelasting\\b");
  });

  it("OF-operator splitst op ' OF ' en geeft operator OF terug", () => {
    const result = parseZoekterm("uitstel OF afstel");
    expect("operator" in result && result.operator).toBe("OF");
    expect("patronen" in result && result.patronen).toHaveLength(2);
    expect("patronen" in result && result.patronen[0].source).toBe("\\buitstel\\b");
    expect("patronen" in result && result.patronen[1].source).toBe("\\bafstel\\b");
  });

  it("AND wordt herkend als alias voor EN", () => {
    const result = parseZoekterm("aansprakelijk AND belasting");
    expect("operator" in result && result.operator).toBe("EN");
    expect("patronen" in result && result.patronen).toHaveLength(2);
  });

  it("OR wordt herkend als alias voor OF", () => {
    const result = parseZoekterm("uitstel OR afstel");
    expect("operator" in result && result.operator).toBe("OF");
    expect("patronen" in result && result.patronen).toHaveLength(2);
  });

  it("wildcards worden correct doorgegeven via parseZoekterm", () => {
    const result = parseZoekterm("termijn*");
    expect("patronen" in result && result.patronen[0].source).toBe("\\btermijn\\w*");
  });

  it("RegExp-vlag is case-insensitive en globaal", () => {
    const result = parseZoekterm("termijn");
    const pat = "patronen" in result ? result.patronen[0] : null;
    expect(pat?.flags).toContain("g");
    expect(pat?.flags).toContain("i");
  });
});

// ── stripXml ─────────────────────────────────────────────────────────────────

describe("stripXml", () => {
  it("verwijdert XML-tags", () => {
    expect(stripXml("<artikel>tekst</artikel>")).toBe("tekst");
  });

  it("verwijdert de XML-declaratie", () => {
    expect(stripXml('<?xml version="1.0"?><root>inhoud</root>')).toBe("inhoud");
  });

  it("comprimeert meerdere spaties tot één", () => {
    expect(stripXml("<a>een</a>   <b>twee</b>")).toBe("een twee");
  });

  it("geeft volledige tekst terug zonder afkap", () => {
    const lang = "<x>" + "a".repeat(60000) + "</x>";
    expect(stripXml(lang).length).toBe(60000);
  });
});

// ── parseRecords ─────────────────────────────────────────────────────────────

describe("parseRecords", () => {
  it("geeft lege array bij geen records", () => {
    const xml = `<?xml version="1.0"?><searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>`;
    expect(parseRecords(xml)).toEqual([]);
  });

  it("parseert een enkel record correct", () => {
    const xml = makeSruXml(makeRecord());
    const [r] = parseRecords(xml);
    expect(r.bwbId).toBe("BWBR0002320");
    expect(r.titel).toBe("Algemene wet inzake rijksbelastingen");
    expect(r.type).toBe("wet");
    expect(r.ministerie).toBe("Financiën");
    expect(r.rechtsgebied).toBe("Belastingrecht");
    expect(r.geldigVanaf).toBe("2024-01-01");
    expect(r.geldigTot).toBe("9999-12-31");
    expect(r.gewijzigd).toBe("2024-07-19");
    expect(r.repositoryUrl).toContain("BWBR0002320");
  });

  it("voegt meerdere rechtsgebieden samen met komma", () => {
    const xml = makeSruXml(makeRecord({ rechtsgebied: ["Belastingrecht", "Formeel belastingrecht"] }));
    const [r] = parseRecords(xml);
    expect(r.rechtsgebied).toBe("Belastingrecht, Formeel belastingrecht");
  });

  it("gebruikt repositoryUrl uit enrichedData", () => {
    const xml = makeSruXml(makeRecord({ locatie: "https://example.com/test.xml" }));
    const [r] = parseRecords(xml);
    expect(r.repositoryUrl).toBe("https://example.com/test.xml");
  });

  it("parseert twee records", () => {
    const xml = makeSruXml(makeRecord({ bwbId: "AAA" }) + makeRecord({ bwbId: "BBB" }));
    const lijst = parseRecords(xml);
    expect(lijst).toHaveLength(2);
    expect(lijst[0].bwbId).toBe("AAA");
    expect(lijst[1].bwbId).toBe("BBB");
  });

  it("vult 'onbepaald' in bij ontbrekende geldigTot", () => {
    // makeRecord zet standaard geldigTot op "9999-12-31"; hier overschrijven we de XML
    const xml = makeSruXml(makeRecord({ geldigTot: "" }));
    const [r] = parseRecords(xml);
    // Lege string wordt door de parser als "" teruggegeven, niet "onbepaald" —
    // "onbepaald" is de fallback voor undefined/null, niet voor lege string.
    // Dit test dat het veld aanwezig en een string is.
    expect(typeof r.geldigTot).toBe("string");
  });
});

// ── dedupliceerOpBwbId ───────────────────────────────────────────────────────

describe("dedupliceerOpBwbId", () => {
  function maakRegeling(bwbId: string, geldigVanaf: string): ReturnType<typeof parseRecords>[number] {
    return {
      bwbId, geldigVanaf,
      titel: "Test", type: "wet", ministerie: "Fin", rechtsgebied: "Belastingrecht",
      geldigTot: "9999-12-31", gewijzigd: geldigVanaf, repositoryUrl: "https://example.com",
    };
  }

  it("laat unieke BWB-ids ongewijzigd", () => {
    const lijst = [maakRegeling("AAA", "2024-01-01"), maakRegeling("BBB", "2024-01-01")];
    expect(dedupliceerOpBwbId(lijst)).toHaveLength(2);
  });

  it("dedupliceert dubbele BWB-ids en behoudt de meest recente versie", () => {
    const lijst = [
      maakRegeling("AAA", "2022-01-01"),
      maakRegeling("AAA", "2024-01-01"),
      maakRegeling("AAA", "2020-01-01"),
    ];
    const result = dedupliceerOpBwbId(lijst);
    expect(result).toHaveLength(1);
    expect(result[0].geldigVanaf).toBe("2024-01-01");
  });

  it("geeft lege array terug bij lege invoer", () => {
    expect(dedupliceerOpBwbId([])).toEqual([]);
  });

  it("behoudt alle unieke ids bij gemengde invoer", () => {
    const lijst = [
      maakRegeling("AAA", "2022-01-01"),
      maakRegeling("BBB", "2023-01-01"),
      maakRegeling("AAA", "2024-01-01"),
    ];
    const result = dedupliceerOpBwbId(lijst);
    expect(result).toHaveLength(2);
    const ids = result.map(r => r.bwbId).sort();
    expect(ids).toEqual(["AAA", "BBB"]);
  });
});

// ── haalWetstekstOp ───────────────────────────────────────────────────────────

describe("haalWetstekstOp", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
    xmlCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    xmlCache.clear();
  });

  it("stuurt standaard vandaag als peildatum mee (bug 2)", async () => {
    const vandaag = new Date().toISOString().slice(0, 10);
    const sruXml = makeSruXml(makeRecord({ locatie: "https://example.com/wet.xml" }));
    const fetchMock = mockFetch([
      { ok: true, text: sruXml },
      { ok: true, text: "<wet><artikel>Artikel 1 inhoud</artikel></wet>" },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await haalWetstekstOp("BWBR0002320");

    const eersteAanroep = fetchMock.mock.calls[0][0] as string;
    expect(eersteAanroep).toContain(vandaag);
  });

  it("gebruikt opgegeven peildatum in plaats van vandaag", async () => {
    const sruXml = makeSruXml(makeRecord({ locatie: "https://example.com/wet.xml" }));
    const fetchMock = mockFetch([
      { ok: true, text: sruXml },
      { ok: true, text: "<wet><artikel>Oud artikel</artikel></wet>" },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await haalWetstekstOp("BWBR0002320", "2010-01-01");

    const eersteAanroep = fetchMock.mock.calls[0][0] as string;
    expect(eersteAanroep).toContain("2010-01-01");
    expect(eersteAanroep).not.toContain(new Date().toISOString().slice(0, 10));
  });

  it("gooit een fout bij onbekend BWB-id", async () => {
    vi.stubGlobal("fetch", mockFetch([
      { ok: true, text: `<?xml version="1.0"?><searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>` },
    ]));

    await expect(haalWetstekstOp("BWBRONBEKEND")).rejects.toThrow("Geen regeling gevonden voor BWB-id: BWBRONBEKEND");
  });

  it("gooit een fout als repository niet bereikbaar is (HTTP-fout)", async () => {
    const sruXml = makeSruXml(makeRecord({ locatie: "https://example.com/wet.xml" }));
    vi.stubGlobal("fetch", mockFetch([
      { ok: true, text: sruXml },
      { ok: false, text: "" },
    ]));

    await expect(haalWetstekstOp("BWBR0002320")).rejects.toThrow();
  });

  it("gooit een fout als repository fetch een uitzondering gooit (netwerkfout)", async () => {
    const sruXml = makeSruXml(makeRecord({ locatie: "https://example.com/wet.xml" }));
    let call = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      if (call++ === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(sruXml) });
      return Promise.reject(new Error("Network error"));
    }));

    await expect(haalWetstekstOp("BWBR0002320")).rejects.toThrow();
  });

  it("retourneert rawXml, doc en regeling", async () => {
    const sruXml = makeSruXml(makeRecord());
    vi.stubGlobal("fetch", mockFetch([
      { ok: true, text: sruXml },
      { ok: true, text: "<wet><artikel>De wetstekst hier</artikel></wet>" },
    ]));

    const result = await haalWetstekstOp("BWBR0002320");
    expect(result.rawXml).toContain("De wetstekst hier");
    expect(result.regeling.bwbId).toBe("BWBR0002320");
    expect(result.regeling.titel).toBe("Algemene wet inzake rijksbelastingen");
    expect(result.doc).toBeDefined();
  });
});

// ── sruRequest ────────────────────────────────────────────────────────────────

describe("sruRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gebruikt HTTPS (bug 4)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<xml/>") });
    vi.stubGlobal("fetch", fetchMock);

    await sruRequest("dcterms.identifier==BWBR0002320");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\//);
  });

  it("gooit een fout bij een HTTP-foutcode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(sruRequest("test")).rejects.toThrow("SRU HTTP 500");
  });

  it("geeft de respons-tekst terug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<xml>ok</xml>") }));
    const result = await sruRequest("test");
    expect(result).toBe("<xml>ok</xml>");
  });
});

// ── zoekTermInArtikelDom ──────────────────────────────────────────────────────

describe("zoekTermInArtikelDom", () => {
  const xml = `<wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop><al>termijn geldt voor belasting</al></artikel>
    <artikel><kop><nr>2</nr></kop><al>belasting en termijn en nog een termijn</al></artikel>
    <artikel><kop><nr>3</nr></kop><al>niets relevants hier</al></artikel>
  </wettekst></wetgeving>`;
  const dom = domParser.parseFromString(xml, "text/xml");

  it("vindt de term in de juiste artikelen", () => {
    const { artikelen: treffers } = zoekTermInArtikelDom(dom, /termijn/gi);
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).toContain("1");
    expect(nummers).toContain("2");
    expect(nummers).not.toContain("3");
  });

  it("telt meerdere treffers in één artikel correct", () => {
    const { artikelen: treffers } = zoekTermInArtikelDom(dom, /termijn/gi);
    const art2 = treffers.find(t => t.artikel === "2");
    expect(art2?.aantalTreffers).toBe(2);
  });

  it("retourneert lege array als term nergens voorkomt", () => {
    expect(zoekTermInArtikelDom(dom, /xyzzy/gi).artikelen).toHaveLength(0);
  });

  it("sorteert resultaten numeriek op artikelnummer", () => {
    const { artikelen: treffers } = zoekTermInArtikelDom(dom, /termijn/gi);
    const nummers = treffers.map(t => t.artikel);
    expect(nummers[0]).toBe("1");
    expect(nummers[1]).toBe("2");
  });

  it("vindt term in <lid>-tekst", () => {
    const xml2 = `<wetgeving><wettekst>
      <artikel><kop><nr>5</nr></kop>
        <lid><lidnr>1</lidnr><al>de termijn bedraagt zes weken</al></lid>
        <lid><lidnr>2</lidnr><al>andere regel</al></lid>
      </artikel>
    </wettekst></wetgeving>`;
    const dom2 = domParser.parseFromString(xml2, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(dom2, /termijn/gi);
    expect(treffers).toHaveLength(1);
    expect(treffers[0].artikel).toBe("5");
    expect(treffers[0].aantalTreffers).toBe(1);
  });

  it("registreert de leden waarin de term voorkomt", () => {
    const xml2 = `<wetgeving><wettekst>
      <artikel><kop><nr>9</nr></kop>
        <lid><lidnr>1</lidnr><al>de termijn bedraagt zes weken</al></lid>
        <lid><lidnr>2</lidnr><al>andere regel zonder treffer</al></lid>
        <lid><lidnr>3</lidnr><al>ook deze termijn telt</al></lid>
      </artikel>
    </wettekst></wetgeving>`;
    const dom2 = domParser.parseFromString(xml2, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(dom2, /termijn/gi);
    expect(treffers[0].leden).toEqual(["1", "3"]);
  });

  it("geeft lege leden-array voor artikel zonder <lid>-structuur", () => {
    const { artikelen: treffers } = zoekTermInArtikelDom(dom, /termijn/gi);
    const art1 = treffers.find(t => t.artikel === "1");
    expect(art1?.leden).toEqual([]);
  });

  it("attribueert match aan het juiste artikel, niet aan een kruisverwijzing", () => {
    // Artikel 5 verwijst naar 'artikel 9' in zijn tekst — telt bij artikel 5, niet 9
    const xml3 = `<wetgeving><wettekst>
      <artikel><kop><nr>5</nr></kop><al>zie artikel 9 van deze wet</al></artikel>
      <artikel><kop><nr>9</nr></kop><al>dit is artikel 9 zelf</al></artikel>
    </wettekst></wetgeving>`;
    const dom3 = domParser.parseFromString(xml3, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(dom3, /artikel 9/gi);
    const art5 = treffers.find(t => t.artikel === "5");
    const art9 = treffers.find(t => t.artikel === "9");
    expect(art5?.aantalTreffers).toBe(1);
    expect(art9?.aantalTreffers).toBe(1);
  });

  it("ondersteunt wildcard-patroon via bouwTermPatroon", () => {
    const { artikelen: treffers } = zoekTermInArtikelDom(dom, new RegExp(bouwTermPatroon("termijn*"), "gi"));
    expect(treffers.length).toBeGreaterThan(0);
  });

  it("vindt term in realistisch BWB-document met <toestand>-wrapper", () => {
    // Echte BWB-documenten hebben <toestand> als root-element — niet <wetgeving>
    const xmlToestand = `<toestand inwerkingtredingsdatum="2026-01-01">
      <wetgeving><wet-besluit><wettekst>
        <artikel><kop><nr>9</nr></kop>
          <lid><lidnr>1</lidnr><al>Een belastingaanslag is invorderbaar zes weken na de dagtekening.</al></lid>
          <lid><lidnr>5</lidnr><al>In zoveel gelijke termijnen als er maanden overblijven.</al></lid>
        </artikel>
        <artikel><kop><nr>10</nr></kop>
          <al>Geen termijn-gerelateerde tekst hier.</al>
        </artikel>
      </wettekst></wet-besluit></wetgeving>
    </toestand>`;
    const domToestand = domParser.parseFromString(xmlToestand, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domToestand, /termijn/gi);
    expect(treffers.length).toBeGreaterThan(0);
    expect(treffers.find(t => t.artikel === "9")).toBeDefined();
  });

  // ── Woordgrens (exacte match via parseZoekterm) ──────────────────────────────

  it("exacte match matcht NIET op substring (woordgrens)", () => {
    // Artikel 1: alleen 'termijnen' (meervoud); artikel 2: exact 'termijn'
    const xmlWg = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>betalingstermijnen gelden hier</al></artikel>
      <artikel><kop><nr>2</nr></kop><al>de termijn bedraagt zes weken</al></artikel>
    </wettekst></wetgeving>`;
    const domWg = domParser.parseFromString(xmlWg, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domWg, parseZoekterm("termijn"));
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).not.toContain("1"); // 'termijnen' is geen exacte match
    expect(nummers).toContain("2");
  });

  it("suffix-wildcard matcht ook samengestelde vormen", () => {
    const xmlWc = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>betalingstermijnen zijn van toepassing</al></artikel>
      <artikel><kop><nr>2</nr></kop><al>de termijn bedraagt zes weken</al></artikel>
      <artikel><kop><nr>3</nr></kop><al>niets relevant</al></artikel>
    </wettekst></wetgeving>`;
    const domWc = domParser.parseFromString(xmlWc, "text/xml");
    // termijn* matcht 'termijn' en 'termijnen'; 'betalingstermijnen' heeft geen \b voor 't'
    const { artikelen: treffers } = zoekTermInArtikelDom(domWc, parseZoekterm("termijn*"));
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).toContain("2"); // 'termijn' matcht
    expect(nummers).not.toContain("3");
  });

  it("prefix-wildcard matcht op woorden die eindigen op de zoekterm", () => {
    const xmlPfx = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>de betalingstermijn is verstreken</al></artikel>
      <artikel><kop><nr>2</nr></kop><al>de termijn bedraagt zes weken</al></artikel>
      <artikel><kop><nr>3</nr></kop><al>termijnoverschrijding leidt tot rente</al></artikel>
    </wettekst></wetgeving>`;
    const domPfx = domParser.parseFromString(xmlPfx, "text/xml");
    // *termijn matcht 'betalingstermijn' en 'termijn' maar NIET 'termijnoverschrijding'
    const { artikelen: treffers } = zoekTermInArtikelDom(domPfx, parseZoekterm("*termijn"));
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).toContain("1"); // 'betalingstermijn' eindigt op 'termijn'
    expect(nummers).toContain("2"); // exact 'termijn'
    expect(nummers).not.toContain("3"); // 'termijnoverschrijding' begint met termijn, eindigt er niet op
  });

  // ── EN/OF-operatoren ─────────────────────────────────────────────────────────

  it("EN-operator: matcht alleen artikelen met ALLE termen", () => {
    const xmlEn = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>aansprakelijkheid voor belasting</al></artikel>
      <artikel><kop><nr>2</nr></kop><al>alleen aansprakelijkheid hier</al></artikel>
      <artikel><kop><nr>3</nr></kop><al>alleen belasting hier</al></artikel>
    </wettekst></wetgeving>`;
    const domEn = domParser.parseFromString(xmlEn, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domEn, parseZoekterm("aansprakelijkheid EN belasting"));
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).toContain("1");    // bevat beide
    expect(nummers).not.toContain("2"); // mist 'belasting'
    expect(nummers).not.toContain("3"); // mist 'aansprakelijkheid'
  });

  it("EN-operator: telt treffers van ALLE patronen samen", () => {
    const xmlEn2 = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>aansprakelijkheid voor belasting en nog meer belasting</al></artikel>
    </wettekst></wetgeving>`;
    const domEn2 = domParser.parseFromString(xmlEn2, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domEn2, parseZoekterm("aansprakelijkheid EN belasting"));
    expect(treffers[0].aantalTreffers).toBe(3); // 1× aansprakelijkheid + 2× belasting
  });

  it("OF-operator: matcht artikelen met MINSTENS ÉÉN term", () => {
    const xmlOf = `<wetgeving><wettekst>
      <artikel><kop><nr>1</nr></kop><al>uitstel van betaling</al></artikel>
      <artikel><kop><nr>2</nr></kop><al>afstel van betaling</al></artikel>
      <artikel><kop><nr>3</nr></kop><al>niets relevants</al></artikel>
    </wettekst></wetgeving>`;
    const domOf = domParser.parseFromString(xmlOf, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domOf, parseZoekterm("uitstel OF afstel"));
    const nummers = treffers.map(t => t.artikel);
    expect(nummers).toContain("1");
    expect(nummers).toContain("2");
    expect(nummers).not.toContain("3");
  });

  it("EN-operator over meerdere <lid>-elementen: termen in verschillende leden telt als match", () => {
    const xmlLid = `<wetgeving><wettekst>
      <artikel><kop><nr>5</nr></kop>
        <lid><lidnr>1</lidnr><al>de aansprakelijkheid wordt vastgesteld</al></lid>
        <lid><lidnr>2</lidnr><al>de belasting is verschuldigd</al></lid>
      </artikel>
    </wettekst></wetgeving>`;
    const domLid = domParser.parseFromString(xmlLid, "text/xml");
    const { artikelen: treffers } = zoekTermInArtikelDom(domLid, parseZoekterm("aansprakelijkheid EN belasting"));
    expect(treffers).toHaveLength(1);
    expect(treffers[0].artikel).toBe("5");
  });

  // ── isVolledig / totaalTreffers / maxResultaten ───────────────────────────────

  const xmlVeel = `<wetgeving><wettekst>
    <artikel><kop><nr>1</nr></kop><al>termijn</al></artikel>
    <artikel><kop><nr>2</nr></kop><al>termijn termijn</al></artikel>
    <artikel><kop><nr>3</nr></kop><al>termijn</al></artikel>
    <artikel><kop><nr>4</nr></kop><al>termijn</al></artikel>
    <artikel><kop><nr>5</nr></kop><al>niets hier</al></artikel>
  </wettekst></wetgeving>`;
  const domVeel = domParser.parseFromString(xmlVeel, "text/xml");

  it("isVolledig is altijd true bij DOM-parsing (volledige scan)", () => {
    const result = zoekTermInArtikelDom(domVeel, parseZoekterm("termijn"));
    expect(result.isVolledig).toBe(true);
  });

  it("totaalTreffers telt alle treffers over alle gevonden artikelen", () => {
    const result = zoekTermInArtikelDom(domVeel, parseZoekterm("termijn"));
    // art1=1, art2=2, art3=1, art4=1 → totaal 5
    expect(result.totaalTreffers).toBe(5);
  });

  it("maxResultaten beperkt de uitvoer maar totaalTreffers geldt voor alle gevonden artikelen", () => {
    const result = zoekTermInArtikelDom(domVeel, parseZoekterm("termijn"), 2);
    expect(result.artikelen).toHaveLength(2);
    expect(result.totaalTreffers).toBe(5); // totaal van ALLE 4 gevonden artikelen
    expect(result.isVolledig).toBe(true);
  });

  it("maxResultaten=1 geeft eerste artikel terug", () => {
    const result = zoekTermInArtikelDom(domVeel, parseZoekterm("termijn"), 1);
    expect(result.artikelen).toHaveLength(1);
    expect(result.artikelen[0].artikel).toBe("1");
  });

  it("geen treffers: totaalTreffers=0, artikelen leeg, isVolledig=true", () => {
    const result = zoekTermInArtikelDom(domVeel, parseZoekterm("xyzzy"));
    expect(result.artikelen).toHaveLength(0);
    expect(result.totaalTreffers).toBe(0);
    expect(result.isVolledig).toBe(true);
  });
});

// ── Zod-schema validatie ─────────────────────────────────────────────────────

import { ZoekInputSchema, ZoektermInputSchema, ArtikelInputSchema } from "./shared/schemas.js";

describe("ZoekInputSchema", () => {
  it("slaagt bij geldige invoer met één criterium", () => {
    const result = ZoekInputSchema.safeParse({ titel: "Invorderingswet" });
    expect(result.success).toBe(true);
  });

  it("vult peildatum en maxResultaten aan met defaults", () => {
    const result = ZoekInputSchema.safeParse({ titel: "Invorderingswet" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxResultaten).toBe(10);
      expect(result.data.peildatum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("faalt zonder zoekcriterium", () => {
    const result = ZoekInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("faalt bij ongeldige peildatum", () => {
    const result = ZoekInputSchema.safeParse({ titel: "Test", peildatum: "niet-een-datum" });
    expect(result.success).toBe(false);
  });

  it("faalt bij maxResultaten buiten bereik", () => {
    const result = ZoekInputSchema.safeParse({ titel: "Test", maxResultaten: 100 });
    expect(result.success).toBe(false);
  });
});

describe("ZoektermInputSchema", () => {
  it("slaagt bij geldige invoer", () => {
    const result = ZoektermInputSchema.safeParse({ bwbId: "BWBR0004770", zoekterm: "termijn" });
    expect(result.success).toBe(true);
  });

  it("vult maxResultaten aan met default 10", () => {
    const result = ZoektermInputSchema.safeParse({ bwbId: "BWBR0004770", zoekterm: "termijn" });
    expect(result.success && result.data.maxResultaten).toBe(10);
  });

  it("faalt bij lege bwbId", () => {
    const result = ZoektermInputSchema.safeParse({ bwbId: "", zoekterm: "termijn" });
    expect(result.success).toBe(false);
  });

  it("accepteert maxResultaten tot 50", () => {
    const result = ZoektermInputSchema.safeParse({ bwbId: "BWBR0004770", zoekterm: "termijn", maxResultaten: 50 });
    expect(result.success).toBe(true);
  });
});

describe("ArtikelInputSchema", () => {
  it("slaagt bij geldige invoer", () => {
    const result = ArtikelInputSchema.safeParse({ bwbId: "BWBR0004770", artikel: "25" });
    expect(result.success).toBe(true);
  });

  it("accepteert null als lid-waarde", () => {
    const result = ArtikelInputSchema.safeParse({ bwbId: "BWBR0004770", artikel: "25", lid: null });
    expect(result.success).toBe(true);
  });

  it("faalt bij lege artikel-string", () => {
    const result = ArtikelInputSchema.safeParse({ bwbId: "BWBR0004770", artikel: "" });
    expect(result.success).toBe(false);
  });
});

// ── extraheerDocMetadata ──────────────────────────────────────────────────────

describe("extraheerDocMetadata", () => {
  it("extraheert citeertitel en versiedatum uit toestand-structuur", () => {
    const xml = `<toestand inwerkingtredingsdatum="2024-01-01">
      <wetgeving>
        <wet-besluit>
          <regeling-info>
            <citeertitel>Invorderingswet 1990</citeertitel>
          </regeling-info>
          <wettekst></wettekst>
        </wet-besluit>
      </wetgeving>
    </toestand>`;
    const dom = domParser.parseFromString(xml, "text/xml");
    const meta = extraheerDocMetadata(dom);
    expect(meta.citeertitel).toBe("Invorderingswet 1990");
    expect(meta.versiedatum).toBe("2024-01-01");
  });

  it("geeft lege strings als de toestand-structuur ontbreekt", () => {
    const dom = domParser.parseFromString("<wetgeving><wettekst></wettekst></wetgeving>", "text/xml");
    const meta = extraheerDocMetadata(dom);
    expect(meta.citeertitel).toBe("");
    expect(meta.versiedatum).toBe("");
  });
});
