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
export function extractCode(err) {
    let cur = err;
    const seen = new Set();
    while (cur && typeof cur === "object" && !seen.has(cur)) {
        seen.add(cur);
        const code = cur.code;
        if (typeof code === "string")
            return code;
        cur = cur.cause;
    }
    return undefined;
}
/** Classificeer op basis van HTTP-status en/of foutcode. */
export function classificeer(code, httpStatus) {
    if (httpStatus !== undefined) {
        if (httpStatus >= 500)
            return "transient"; // 502/503/504 e.d. — gateway/tijdelijk
        if (httpStatus >= 400)
            return "permanent"; // 4xx — gaat niet vanzelf over
    }
    if (code) {
        if (TLS_CODES.has(code))
            return "permanent";
        if (TRANSIENT_NET_CODES.has(code))
            return "transient";
    }
    return "onbekend";
}
/** Fout van een upstream-aanroep, met genoeg context om te diagnosticeren én classificeren. */
export class UpstreamError extends Error {
    bron;
    url;
    httpStatus;
    code;
    klasse;
    constructor(message, opts = {}) {
        super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = "UpstreamError";
        this.bron = opts.bron;
        this.url = opts.url;
        this.httpStatus = opts.httpStatus;
        this.code = opts.code ?? extractCode(opts.cause);
        this.klasse = opts.klasse ?? classificeer(this.code, this.httpStatus);
    }
}
/**
 * Fout door verkeerde of niet-resolvebare client-input: validatiefouten, een
 * onbekend artikel of lid. Classificeert als `client` zodat de foutrespons en de
 * auditlog een verkeerde input onderscheiden van een upstream-storing, en de
 * melding hoort de LLM-client te vertellen wat de volgende stap is.
 */
export class ClientInputError extends Error {
    constructor(message) {
        super(message);
        this.name = "ClientInputError";
    }
}
function hostVan(url) {
    if (!url)
        return undefined;
    try {
        return new URL(url).host;
    }
    catch {
        return undefined;
    }
}
/** Pak gestructureerde, log-veilige details uit een willekeurige fout. */
export function foutDetails(err) {
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
        const isClient = err.name === "ZodError" || err instanceof ClientInputError;
        const code = extractCode(err);
        return {
            bericht: err.message,
            code,
            klasse: isClient ? "client" : classificeer(code, undefined),
        };
    }
    return { bericht: String(err), klasse: "onbekend" };
}
/** Permanente fouten verdienen `error` (operationele actie); de rest is `warn`. */
export function logNiveauVoor(klasse) {
    return klasse === "permanent" ? "error" : "warn";
}
/**
 * Begrens een belofte met een totale deadline; gooit een transiënte UpstreamError bij
 * overschrijding. De optionele AbortController wordt bij overschrijding ge-abort, zodat
 * onderliggende fetches daadwerkelijk worden geannuleerd in plaats van door te lopen
 * (verspilde sockets/geheugen op een drukke server).
 */
export function metDeadline(p, ms, label, controller) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            controller?.abort();
            reject(new UpstreamError(`tool-timeout: ${label} overschreed ${ms} ms`, {
                bron: "tool",
                code: "TOOL_TIMEOUT",
                klasse: "transient",
            }));
        }, ms);
        p.then((v) => {
            clearTimeout(timer);
            resolve(v);
        }, (e) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}
