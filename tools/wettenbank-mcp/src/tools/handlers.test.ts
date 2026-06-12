/**
 * Contracttests voor de vier toolhandlers, met gemockte upstream-clients.
 *
 * Twee borgingen die elders ontbraken:
 *  1. de handler-logica zelf (lid-filter, foutpaden, duplicaat-waarschuwing,
 *     sectie/diepte-filters) draait tegen de echte parse-keten;
 *  2. elke respons wordt gevalideerd tegen het bijbehorende OutputSchema, zodat
 *     het gedocumenteerde contract en de werkelijke output niet kunnen driften.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { handleArtikel } from "./artikel.js";
import { handleStructuur } from "./structuur.js";
import { handleZoek } from "./zoek.js";
import { handleZoekterm } from "./zoekterm.js";
import {
  ArtikelOutputSchema,
  StructuurOutputSchema,
  ZoekOutputSchema,
  ZoektermOutputSchema,
} from "../shared/schemas.js";
import { ClientInputError } from "../shared/fouten.js";
import { parseXmlDoc } from "../clients/sru-client.js";
import type { Regeling } from "../clients/sru-client.js";

const FIXTURE = readFileSync(
  new URL("../bwb-parser/fixtures/toestand-fixture.xml", import.meta.url),
  "utf8"
);

const REGELING: Regeling = {
  bwbId: "BWBR0099999",
  titel: "Testwet brongetrouwheid",
  type: "wet",
  ministerie: "Financiën",
  rechtsgebied: "belastingrecht",
  geldigVanaf: "2024-01-01",
  geldigTot: "onbepaald",
  gewijzigd: "2024-01-01",
  repositoryUrl: "https://repository.officiele-overheidspublicaties.nl/bwb/BWBR0099999/x.xml",
};

vi.mock("../clients/repository-client.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../clients/repository-client.js")>();
  return { ...orig, haalWetstekstOp: vi.fn() };
});
vi.mock("../clients/sru-client.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../clients/sru-client.js")>();
  return { ...orig, sruRequest: vi.fn() };
});

import { haalWetstekstOp } from "../clients/repository-client.js";
import { sruRequest } from "../clients/sru-client.js";

beforeEach(() => {
  vi.mocked(haalWetstekstOp).mockResolvedValue({
    rawXml: FIXTURE,
    doc: parseXmlDoc(FIXTURE, "test"),
    regeling: REGELING,
  });
});

describe("handleArtikel", () => {
  it("valideert tegen het ArtikelOutputSchema en levert aanhef + leden met jci per lid", async () => {
    const uit = JSON.parse(await handleArtikel({ bwbId: "BWBR0099999", artikel: "9" }));
    const res = ArtikelOutputSchema.parse(uit);
    expect(res.citeertitel).toBe("Testwet brongetrouwheid");
    expect(res.type).toBe("wet");
    expect(res.pad).toBe("Hoofdstuk I Algemene bepalingen > Afdeling 1.2 Betaling > Artikel 9");
    // Aanhef (lid "") + lid 1 + lid 2, in documentvolgorde.
    expect(res.leden.map((l) => l.lid)).toEqual(["", "1", "2"]);
    expect(res.leden[2].bronreferentie).toBe(
      "jci1.3:c:BWBR0099999&artikel=9&lid=2&g=2024-01-01"
    );
    expect(res.bronreferentie).toBe("jci1.3:c:BWBR0099999&artikel=9&g=2024-01-01");
  });

  it("matcht artikelnummers case-insensitief en getrimd ('9A' vindt '9a')", async () => {
    const uit = JSON.parse(
      await handleArtikel({ bwbId: "BWBR0099999", artikel: " 9A " })
    );
    expect(uit.leden[0].tekst).toContain("negen-a");
  });

  it("waarschuwt bij dubbele artikelnummers (wettekst + bijlage)", async () => {
    const uit = JSON.parse(await handleArtikel({ bwbId: "BWBR0099999", artikel: "1" }));
    const res = ArtikelOutputSchema.parse(uit);
    expect(res.waarschuwing).toMatch(/2 elementen met nummer 1/);
    expect(res.leden[0].tekst).toContain("ontvanger"); // wettekst-exemplaar wint
  });

  it("gooit een actionable client-fout bij een onbekend artikel, met suggesties", async () => {
    const fout = await handleArtikel({ bwbId: "BWBR0099999", artikel: "99" }).then(
      () => null,
      (e) => e as Error
    );
    expect(fout).toBeInstanceOf(ClientInputError);
    expect(fout!.message).toContain("Artikel 99 niet gevonden");
    expect(fout!.message).toContain("Bestaat wel: 9");
    expect(fout!.message).toContain("wettenbank_structuur");
  });

  it("gooit een client-fout bij een onbekend lid en noemt de beschikbare leden", async () => {
    const fout = await handleArtikel({
      bwbId: "BWBR0099999",
      artikel: "9",
      lid: "3",
    }).then(() => null, (e) => e as Error);
    expect(fout).toBeInstanceOf(ClientInputError);
    expect(fout!.message).toContain("Lid 3 niet gevonden");
    expect(fout!.message).toContain("Beschikbare leden: 1, 2");
  });

  it("meldt álle validatie-issues mét veldpad in één keer", async () => {
    const fout = await handleArtikel({ bwbId: "fout-id" }).then(
      () => null,
      (e) => e as Error
    );
    expect(fout).toBeInstanceOf(ClientInputError);
    expect(fout!.message).toContain("bwbId:");
    expect(fout!.message).toContain("artikel");
    expect(fout!.message).toContain(";");
  });
});

describe("handleStructuur", () => {
  it("valideert tegen het StructuurOutputSchema en bevat type + bijlage", async () => {
    const uit = JSON.parse(await handleStructuur({ bwbId: "BWBR0099999" }));
    const res = StructuurOutputSchema.parse(uit);
    expect(res.type).toBe("wet");
    expect(res.structuur.map((n) => n.type)).toEqual(["hoofdstuk", "bijlage"]);
  });

  it("markeert afgekapte niveaus met ingekort=true bij diepte=1", async () => {
    const uit = JSON.parse(await handleStructuur({ bwbId: "BWBR0099999", diepte: 1 }));
    const res = StructuurOutputSchema.parse(uit);
    const hoofdstuk = res.structuur[0];
    expect(hoofdstuk.secties).toBeUndefined();
    expect(hoofdstuk.ingekort).toBe(true);
  });

  it("filtert op sectie (titel-substring) en gooit een client-fout bij geen match", async () => {
    const uit = JSON.parse(
      await handleStructuur({ bwbId: "BWBR0099999", sectie: "Betaling" })
    );
    const res = StructuurOutputSchema.parse(uit);
    expect(res.structuur).toHaveLength(1);
    expect(res.structuur[0].nr).toBe("1.2");

    await expect(
      handleStructuur({ bwbId: "BWBR0099999", sectie: "bestaat-niet" })
    ).rejects.toBeInstanceOf(ClientInputError);
  });
});

describe("handleZoek", () => {
  const sruXml = (numberOfRecords: number, records: string) => `<?xml version="1.0"?>
<searchRetrieveResponse
  xmlns:overheidbwb="http://standaarden.overheid.nl/owms/terms/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:overheid="http://standaarden.overheid.nl/owms/terms/">
  <numberOfRecords>${numberOfRecords}</numberOfRecords>
  <records>${records}</records>
</searchRetrieveResponse>`;

  const record = (bwbId: string, titel: string) => `
  <record><recordData><gzd>
    <originalData><overheidbwb:meta><owmskern>
      <dcterms:identifier>${bwbId}</dcterms:identifier>
      <dcterms:title>${titel}</dcterms:title>
      <dcterms:type>wet</dcterms:type>
      <overheid:authority>Financiën</overheid:authority>
      <dcterms:modified>2024-01-01</dcterms:modified>
    </owmskern>
    <bwbipm>
      <overheidbwb:rechtsgebied>belastingrecht</overheidbwb:rechtsgebied>
      <overheidbwb:geldigheidsperiode_startdatum>2020-01-01</overheidbwb:geldigheidsperiode_startdatum>
      <overheidbwb:geldigheidsperiode_einddatum>9999-12-31</overheidbwb:geldigheidsperiode_einddatum>
    </bwbipm></overheidbwb:meta></originalData>
    <enrichedData><overheidbwb:locatie_toestand>https://repository.officiele-overheidspublicaties.nl/bwb/${bwbId}/x.xml</overheidbwb:locatie_toestand></enrichedData>
  </gzd></recordData></record>`;

  it("meldt afkapping eerlijk: totaalBeschikbaar + isVolledig", async () => {
    vi.mocked(sruRequest).mockResolvedValue(
      sruXml(25, record("BWBR0000001", "Wet A") + record("BWBR0000002", "Wet B"))
    );
    const uit = JSON.parse(await handleZoek({ titel: "Invorderingswet", maxResultaten: 2 }));
    const res = ZoekOutputSchema.parse(uit);
    expect(res.totaal).toBe(2);
    expect(res.totaalBeschikbaar).toBe(25);
    expect(res.isVolledig).toBe(false);
  });

  it("gebruikt CQL 'all' bij meerwoordige titels en 'any' bij één woord", async () => {
    vi.mocked(sruRequest).mockResolvedValue(sruXml(1, record("BWBR0000001", "Wet milieubeheer")));
    await handleZoek({ titel: "Wet milieubeheer" });
    expect(vi.mocked(sruRequest).mock.calls.at(-1)![0]).toContain('overheidbwb.titel all "Wet milieubeheer"');
    await handleZoek({ titel: "Invorderingswet" });
    expect(vi.mocked(sruRequest).mock.calls.at(-1)![0]).toContain('overheidbwb.titel any "Invorderingswet"');
  });
});

describe("handleZoekterm", () => {
  it("valideert tegen het ZoektermOutputSchema en geeft elke treffer een jci-uri", async () => {
    const uit = JSON.parse(
      await handleZoekterm({ bwbId: "BWBR0099999", zoekterm: "betaling" })
    );
    const res = ZoektermOutputSchema.parse(uit);
    expect(res.citeertitel).toBe("Testwet brongetrouwheid");
    expect(res.artikelen.length).toBeGreaterThan(0);
    for (const art of res.artikelen) {
      expect(art.bronreferentie).toBe(
        `jci1.3:c:BWBR0099999&artikel=${art.artikel}&g=2024-01-01`
      );
    }
  });

  it("levert bij includeerTekst ook pad en tekst per artikel", async () => {
    const uit = JSON.parse(
      await handleZoekterm({ bwbId: "BWBR0099999", zoekterm: "betaling", includeerTekst: true })
    );
    const res = ZoektermOutputSchema.parse(uit);
    const art9 = res.artikelen.find((a) => a.artikel === "9");
    expect(art9?.pad).toBe("Hoofdstuk I Algemene bepalingen > Afdeling 1.2 Betaling > Artikel 9");
    expect(art9?.tekst).toContain("Bij de betaling gelden");
  });
});

describe("gegenereerde tool-inputschema's (server.ts)", () => {
  it("genereert het JSON-inputschema rechtstreeks uit Zod — geen drift mogelijk", async () => {
    const { alsJsonSchema } = await import("../server.js");
    const { ArtikelInputSchema } = await import("../shared/schemas.js");
    const json = alsJsonSchema(ArtikelInputSchema) as {
      type: string;
      required?: string[];
      properties: Record<string, { description?: string; pattern?: string }>;
      $schema?: string;
    };
    expect(json.type).toBe("object");
    expect(json.$schema).toBeUndefined();
    expect(json.required).toEqual(expect.arrayContaining(["bwbId", "artikel"]));
    // De Zod-validatie (BWBR-patroon) en .describe()-teksten reizen mee.
    expect(json.properties.bwbId.pattern).toContain("BWBR");
    expect(json.properties.lid.description).toContain("lidnummer");
  });
});
