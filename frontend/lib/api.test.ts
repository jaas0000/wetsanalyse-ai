import { afterEach, describe, expect, it, vi } from "vitest";
import { annoteerAgentStream, isApiError, parseError, startRun, volgRun } from "./api";

describe("parseError", () => {
  it("haalt een string-detail uit de JSON-body", async () => {
    const res = new Response(JSON.stringify({ detail: "Onbekend project" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const err = await parseError(res);
    expect(err).toMatchObject({ status: 404, detail: "Onbekend project" });
    expect(err.retryAfter).toBeUndefined();
  });

  it("stringificeert een niet-string detail (bv. validatiefouten)", async () => {
    const res = new Response(JSON.stringify({ detail: [{ msg: "te lang" }] }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
    const err = await parseError(res);
    expect(err.status).toBe(422);
    expect(err.detail).toContain("te lang");
  });

  it("valt terug op statusText zonder JSON-body", async () => {
    const res = new Response("kapot", { status: 502, statusText: "Bad Gateway" });
    const err = await parseError(res);
    expect(err.status).toBe(502);
    expect(err.detail).toBe("Bad Gateway");
  });

  it("leest de Retry-After-header als getal", async () => {
    const res = new Response(JSON.stringify({ detail: "te druk" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "12" },
    });
    const err = await parseError(res);
    expect(err.retryAfter).toBe(12);
  });
});

function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("annoteerAgentStream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("splitst token/sources/doel/element-frames (incl. \\r\\n) naar de juiste handlers", async () => {
    const element = { klasse: "Rechtssubject", tekst: "de ontvanger" };
    const frames = [
      `data: ${JSON.stringify({ type: "status", message: "Graaf bevragen: get_artikel" })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "reason", content: "Ik zoek dit op." })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "token", content: "Antwoord " })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "token", content: "hier." })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "sources", sources: [{ label: "IW art. 9", uri: "x" }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "doel", doel: { bwbId: "BWBR0004770", artikel: "9", lid: "1" } })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "element", element })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "ontbrekend", items: [{ klasse: "Rechtsfeit", reden: "handeling" }] })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "done" })}\r\n\r\n`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));

    let tekst = "";
    let denk = "";
    let doel: unknown = null;
    const elementen: unknown[] = [];
    let ontbrekend: unknown[] = [];
    let bronnen: unknown[] = [];
    await annoteerAgentStream("annoteer artikel 9 lid 1 IW", {
      onStatus: (m) => (denk += `[${m}]`),
      onReason: (t) => (denk += t),
      onToken: (t) => (tekst += t),
      onSources: (b) => (bronnen = b),
      onDoel: (d) => (doel = d),
      onElement: (e) => elementen.push(e),
      onOntbrekend: (items) => (ontbrekend = items),
    });

    expect(tekst).toBe("Antwoord hier."); // token = alléén het eindantwoord
    expect(denk).toBe("[Graaf bevragen: get_artikel]Ik zoek dit op."); // status + reason = denkproces
    expect(bronnen).toEqual([{ label: "IW art. 9", uri: "x" }]);
    expect(doel).toEqual({ bwbId: "BWBR0004770", artikel: "9", lid: "1" });
    expect(elementen).toEqual([element]);
    expect(ontbrekend).toEqual([{ klasse: "Rechtsfeit", reden: "handeling" }]);
  });
});

describe("volgRun — aanhaken bij een lopende beurt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("meldt het volgnummer terug, zodat aanhaken na een onderbreking op het juiste punt begint", async () => {
    const frames = [
      `data: ${JSON.stringify({ type: "token", content: "een ", seq: 4 })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "token", content: "antwoord", seq: 5 })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "done", seq: 6 })}\r\n\r\n`,
    ];
    const nep = vi.fn(async (_url: string | URL) => sseResponse(frames));
    vi.stubGlobal("fetch", nep);

    let tekst = "";
    const seqs: number[] = [];
    await volgRun("run-1", { onToken: (t) => (tekst += t), onSeq: (n) => seqs.push(n) }, 4);

    expect(tekst).toBe("een antwoord");
    expect(seqs).toEqual([4, 5, 6]);
    // De cursor gaat mee in de URL: je vraagt precies wat je miste, niet de hele beurt opnieuw.
    expect(String(nep.mock.calls[0]?.[0])).toContain("vanaf=4");
  });

  it("benoemt een gat in plaats van stilzwijgend een verminkte tekst te leveren", async () => {
    const frames = [
      `data: ${JSON.stringify({ type: "gat", weggevallen: 12 })}\r\n\r\n`,
      `data: ${JSON.stringify({ type: "token", content: "de rest", seq: 12 })}\r\n\r\n`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(frames)));

    let gat = 0;
    let tekst = "";
    await volgRun("run-1", { onGat: (n) => (gat = n), onToken: (t) => (tekst += t) });

    expect(gat).toBe(12);
    expect(tekst).toBe("de rest");
  });
});

describe("startRun — er loopt er al een", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gooit bij 409, mét het id van de lopende run erbij", async () => {
    // Twee gelijktijdige beurten op één gesprek zouden door elkaar heen in het agent-geheugen
    // schrijven (thread_id == conversation_id) — vandaar dat de server weigert en verwijst.
    //
    // Gooien en niet stilzwijgend de bestaande run teruggeven: deze vráág is niet aangenomen. Gaf
    // `startRun` hier gewoon de lopende run terug, dan verscheen het antwoord op de vórige vraag
    // onder de nieuwe, en ging de nieuwe stilzwijgend verloren. De aanroeper kan met `loopendeRun`
    // alsnog aanhaken — maar dan wél wetend dat er iets anders speelt.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: { reden: "run_loopt_al", run_id: "run-bestaand" } }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    )));

    await expect(startRun("nog een vraag", "gesprek-1")).rejects.toMatchObject({
      status: 409,
      loopendeRun: "run-bestaand",
    });
  });

  it("laat een echte fout wél een fout zijn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "Agent onbereikbaar" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )));
    await expect(startRun("vraag", "gesprek-1")).rejects.toMatchObject({ status: 502 });
  });
});

describe("isApiError", () => {
  it("herkent een ApiError-vorm", () => {
    expect(isApiError({ status: 404, detail: "x" })).toBe(true);
  });
  it("wijst andere waarden af", () => {
    expect(isApiError(new Error("boom"))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("tekst")).toBe(false);
  });
});
