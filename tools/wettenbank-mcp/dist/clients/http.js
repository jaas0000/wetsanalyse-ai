/**
 * Gedeelde HTTP-helper voor de upstream-clients (SRU + repository).
 *
 * De bronnen van overheid.nl zijn berucht traag/wisselvallig; één transiënte fout zou
 * anders de hele tool-call doen falen. `fetchMetRetry` voegt per poging een timeout toe
 * (AbortController) en herprobeert **alleen** bij transiënte fouten — netwerk/timeout en
 * de gateway-statussen 502/503/504 — met exponentiële backoff + jitter. Niet-transiënte
 * antwoorden (2xx, maar ook 4xx en 500) worden direct teruggegeven; de aanroeper bepaalt
 * zelf via `res.ok` wat een fout is, zodat de bestaande foutmeldingen behouden blijven.
 */
import { UpstreamError } from "../shared/fouten.js";
const RETRYABLE_STATUS = new Set([502, 503, 504]);
function slaap(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Voert een `fetch` uit met per-poging-timeout en herprobeert transiënte fouten.
 * Gooit bij uitputting de laatste netwerk-/timeout-fout door; retourneert anders de
 * (mogelijk niet-ok) `Response`.
 */
export async function fetchMetRetry(url, init = {}, opts = {}) {
    if (typeof fetch === "undefined") {
        throw new Error("fetch is niet beschikbaar in deze runtime");
    }
    const pogingen = opts.pogingen ?? 3;
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const baseDelayMs = opts.baseDelayMs ?? 250;
    const bron = opts.bron ?? "upstream";
    let laatsteFout;
    let laatsteStatus;
    for (let poging = 1; poging <= pogingen; poging++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            // Transiënte gateway-status: herprobeer tenzij dit de laatste poging was.
            if (RETRYABLE_STATUS.has(res.status) && poging < pogingen) {
                laatsteStatus = res.status;
                laatsteFout = new Error(`${bron} HTTP ${res.status}`);
            }
            else {
                return res;
            }
        }
        catch (err) {
            // AbortError (timeout) en netwerkfouten zijn transiënt → herproberen. De echte
            // oorzaak (undici `.cause`) bewaren we via `cause` voor diagnose verderop.
            laatsteFout =
                err.name === "AbortError"
                    ? new UpstreamError(`${bron}-timeout na ${timeoutMs / 1000}s`, {
                        bron,
                        url,
                        code: "ETIMEDOUT",
                        klasse: "transient",
                        cause: err,
                    })
                    : err;
            if (poging >= pogingen)
                break;
        }
        finally {
            clearTimeout(timeoutId);
        }
        // Backoff met jitter vóór de volgende poging.
        const wacht = baseDelayMs * 2 ** (poging - 1) + Math.floor(Math.random() * baseDelayMs);
        await slaap(wacht);
    }
    // Verpak tot een UpstreamError met bron/host/cause — de `.message` blijft gelijk
    // (backward-compat met bestaande consumers en tests).
    if (laatsteFout instanceof UpstreamError)
        throw laatsteFout;
    const bericht = laatsteFout instanceof Error
        ? laatsteFout.message
        : `${bron}-verzoek mislukt na ${pogingen} pogingen`;
    throw new UpstreamError(bericht, { bron, url, httpStatus: laatsteStatus, cause: laatsteFout });
}
