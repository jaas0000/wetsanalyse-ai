/**
 * Gedeelde HTTP-helper voor de upstream-clients (SRU + repository).
 *
 * De bronnen van overheid.nl zijn berucht traag/wisselvallig; één transiënte fout zou
 * anders de hele tool-call doen falen. `fetchMetRetry` voegt per poging een timeout toe
 * (AbortController) en herprobeert **alleen** bij transiënte fouten — netwerk/timeout en
 * de gateway-statussen 502/503/504 — met exponentiële backoff + jitter. Niet-transiënte
 * antwoorden (2xx, maar ook 4xx en 500) worden direct teruggegeven; de aanroeper bepaalt
 * zelf via `res.ok` wat een fout is, zodat de bestaande foutmeldingen behouden blijven.
 *
 * `fetchTekstMetRetry` leest bovendien de body bínnen hetzelfde timeout-venster: een
 * upstream die snel headers maar druppelsgewijs de body stuurt, kan dan niet voorbij de
 * per-poging-timeout blijven hangen. Via `opts.signal` (tool-deadline uit server.ts)
 * worden lopende pogingen ook echt geannuleerd in plaats van op de achtergrond door te
 * lopen.
 */

import { UpstreamError } from "../shared/fouten.js";
import { buildInfo } from "../build-info.js";

const RETRYABLE_STATUS = new Set([502, 503, 504]);

// Identificeerbare User-Agent richting de publieke overheids-API's: nette praktijk en
// het maakt rate-limit-/incidentdiagnose aan hun kant mogelijk.
const USER_AGENT = `wettenbank-mcp/${buildInfo.version} (+https://github.com/palmw01/wetsanalyse-ai)`;

export interface FetchRetryOpts {
  /** Totaal aantal pogingen (incl. de eerste). Default 3. */
  pogingen?: number;
  /** Timeout per poging in ms. Default 15000. */
  timeoutMs?: number;
  /** Basisvertraging voor de backoff in ms (poging n wacht ~base * 2^(n-1) + jitter). */
  baseDelayMs?: number;
  /** Bronlabel voor de timeout-foutmelding (bijv. "SRU"). */
  bron?: string;
  /** Extern abortsignaal (tool-deadline): annuleert de lopende poging en stopt retries. */
  signal?: AbortSignal;
}

/** Respons van fetchTekstMetRetry: status + body, body gelezen binnen de timeout. */
export interface TekstRespons {
  ok: boolean;
  status: number;
  tekst: string;
}

function slaap(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Voert een `fetch` uit met per-poging-timeout en herprobeert transiënte fouten.
 * Gooit bij uitputting de laatste netwerk-/timeout-fout door; retourneert anders de
 * (mogelijk niet-ok) `Response`. Let op: de body valt hier búiten het timeout-venster —
 * gebruik `fetchTekstMetRetry` wanneer je de body nodig hebt.
 */
export function fetchMetRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOpts = {}
): Promise<Response> {
  return fetchKern(url, init, opts, async (res) => res);
}

/** Als fetchMetRetry, maar leest de body als tekst bínnen het timeout-venster. */
export function fetchTekstMetRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOpts = {}
): Promise<TekstRespons> {
  return fetchKern(url, init, opts, async (res) => ({
    ok: res.ok,
    status: res.status,
    // Body van een foutstatus is niet interessant; niet lezen scheelt tijd/geheugen.
    tekst: res.ok ? await res.text() : "",
  }));
}

async function fetchKern<T>(
  url: string,
  init: RequestInit,
  opts: FetchRetryOpts,
  verwerk: (res: Response) => Promise<T>
): Promise<T> {
  if (typeof fetch === "undefined") {
    throw new Error("fetch is niet beschikbaar in deze runtime");
  }
  const pogingen = opts.pogingen ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const bron = opts.bron ?? "upstream";

  const deadlineFout = (cause?: unknown) =>
    new UpstreamError(`${bron}: afgebroken door tool-deadline`, {
      bron,
      url,
      code: "TOOL_TIMEOUT",
      klasse: "transient",
      ...(cause !== undefined && { cause }),
    });

  let laatsteFout: unknown;
  let laatsteStatus: number | undefined;
  for (let poging = 1; poging <= pogingen; poging++) {
    if (opts.signal?.aborted) throw deadlineFout();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts.signal
      ? AbortSignal.any([controller.signal, opts.signal])
      : controller.signal;
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
        signal,
      });
      // Transiënte gateway-status: herprobeer tenzij dit de laatste poging was.
      if (RETRYABLE_STATUS.has(res.status) && poging < pogingen) {
        laatsteStatus = res.status;
        laatsteFout = new Error(`${bron} HTTP ${res.status}`);
      } else {
        // verwerk() (bv. body lezen) gebeurt vóór clearTimeout: ook het body-lezen
        // valt zo binnen de per-poging-timeout.
        return await verwerk(res);
      }
    } catch (err) {
      // Externe annulering (tool-deadline): direct stoppen, niet herproberen.
      if (opts.signal?.aborted) throw deadlineFout(err);
      // AbortError (timeout) en netwerkfouten zijn transiënt → herproberen. De echte
      // oorzaak (undici `.cause`) bewaren we via `cause` voor diagnose verderop.
      laatsteFout =
        (err as Error).name === "AbortError"
          ? new UpstreamError(`${bron}-timeout na ${timeoutMs / 1000}s`, {
              bron,
              url,
              code: "ETIMEDOUT",
              klasse: "transient",
              cause: err,
            })
          : err;
      if (poging >= pogingen) break;
    } finally {
      clearTimeout(timeoutId);
    }
    // Backoff met jitter vóór de volgende poging.
    const wacht = baseDelayMs * 2 ** (poging - 1) + Math.floor(Math.random() * baseDelayMs);
    await slaap(wacht);
  }
  // Verpak tot een UpstreamError met bron/host/cause — de `.message` blijft gelijk
  // (backward-compat met bestaande consumers en tests).
  if (laatsteFout instanceof UpstreamError) throw laatsteFout;
  const bericht =
    laatsteFout instanceof Error
      ? laatsteFout.message
      : `${bron}-verzoek mislukt na ${pogingen} pogingen`;
  throw new UpstreamError(bericht, { bron, url, httpStatus: laatsteStatus, cause: laatsteFout });
}
