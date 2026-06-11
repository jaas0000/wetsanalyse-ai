/**
 * Gestructureerd foutmodel voor diagnosticeerbare upstream-fouten.
 *
 * Aanleiding: een incomplete TLS-keten upstream gaf alleen de generieke melding
 * "fetch failed"; de echte oorzaak (undici `.cause.code`), de bron en de HTTP-status
 * gingen verloren, wat diagnose traag maakte. `UpstreamError` draagt die context;
 * `foutDetails()` haalt 'm er — ook uit een gewone `Error` met `.cause`-keten —
 * gestructureerd uit en classificeert de fout:
 *   - transient  : herproberen kan helpen (timeout, netwerk, 5xx)
 *   - permanent  : operationele actie nodig (TLS/cert, 4xx) → logt op `error`
 *   - client     : verkeerde input (Zod-validatie)
 *   - onbekend   : niet te classificeren
 *
 * Backward-compat: de `.message`-strings van de bestaande fouten blijven ongewijzigd;
 * nieuwe informatie zit uitsluitend in extra velden.
 */

export type FoutKlasse = "transient" | "permanent" | "client" | "onbekend";

/** TLS-/certificaat-foutcodes (Node/OpenSSL): niet zelf-herstellend → permanent. */
const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
]);

/** Netwerk-/timeout-codes (Node/undici): kunnen vanzelf overgaan → transient. */
const TRANSIENT_NET_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Loopt de `cause`-keten af tot de eerste `.code`-string (undici verpakt de echte fout). */
export function extractCode(err: unknown): string | undefined {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Classificeer op basis van HTTP-status en/of foutcode. */
export function classificeer(code: string | undefined, httpStatus: number | undefined): FoutKlasse {
  if (httpStatus !== undefined) {
    if (httpStatus >= 500) return "transient"; // 502/503/504 e.d. — gateway/tijdelijk
    if (httpStatus >= 400) return "permanent"; // 4xx — gaat niet vanzelf over
  }
  if (code) {
    if (TLS_CODES.has(code)) return "permanent";
    if (TRANSIENT_NET_CODES.has(code)) return "transient";
  }
  return "onbekend";
}

export interface UpstreamErrorOpts {
  bron?: string;
  url?: string;
  httpStatus?: number;
  code?: string;
  klasse?: FoutKlasse;
  cause?: unknown;
}

/** Fout van een upstream-aanroep, met genoeg context om te diagnosticeren én classificeren. */
export class UpstreamError extends Error {
  readonly bron?: string;
  readonly url?: string;
  readonly httpStatus?: number;
  readonly code?: string;
  readonly klasse: FoutKlasse;

  constructor(message: string, opts: UpstreamErrorOpts = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "UpstreamError";
    this.bron = opts.bron;
    this.url = opts.url;
    this.httpStatus = opts.httpStatus;
    this.code = opts.code ?? extractCode(opts.cause);
    this.klasse = opts.klasse ?? classificeer(this.code, this.httpStatus);
  }
}

export interface FoutDetail {
  bericht: string;
  code?: string;
  klasse: FoutKlasse;
  bron?: string;
  /** Alleen de host (geen query) — query kan een zoekterm bevatten (AVG-dataminimalisatie). */
  host?: string;
  httpStatus?: number;
}

function hostVan(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Pak gestructureerde, log-veilige details uit een willekeurige fout. */
export function foutDetails(err: unknown): FoutDetail {
  if (err instanceof UpstreamError) {
    return {
      bericht: err.message,
      code: err.code,
      klasse: err.klasse,
      bron: err.bron,
      host: hostVan(err.url),
      httpStatus: err.httpStatus,
    };
  }
  if (err instanceof Error) {
    const isZod = err.name === "ZodError";
    const code = extractCode(err);
    return {
      bericht: err.message,
      code,
      klasse: isZod ? "client" : classificeer(code, undefined),
    };
  }
  return { bericht: String(err), klasse: "onbekend" };
}

/** Permanente fouten verdienen `error` (operationele actie); de rest is `warn`. */
export function logNiveauVoor(klasse: FoutKlasse): "warn" | "error" {
  return klasse === "permanent" ? "error" : "warn";
}

/** Begrens een belofte met een totale deadline; gooit een transiënte UpstreamError bij overschrijding. */
export function metDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new UpstreamError(`tool-timeout: ${label} overschreed ${ms} ms`, {
          bron: "tool",
          code: "TOOL_TIMEOUT",
          klasse: "transient",
        })
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
