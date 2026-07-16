/**
 * Gestructureerde JSON-logging voor de Wettenbank MCP-server.
 *
 * Eén regel JSON per gebeurtenis naar **stderr** — stdout blijft schoon voor het
 * stdio-transport. De app schrijft bewust géén eigen logbestanden: de
 * containerruntime/SIEM vangt stderr op (12-factor + NORA "centrale verzameling").
 *
 * Normenkader (BIO2 / NEN-EN-ISO/IEC 27002:2022):
 *   - 8.15 Logging — gebeurtenissen registreren in een vaste, machine-leesbare vorm.
 *   - 8.16 Monitoring — auth/security-events apart herkenbaar (`category`).
 *   - 8.17 Clock synchronisation — tijdstempels in UTC (ISO-8601).
 *
 * AVG/dataminimalisatie: tokens en de `Authorization`-header worden nooit gelogd;
 * rauwe zoektermen evenmin (kunnen onthullen wat een ambtenaar onderzoekt), tenzij
 * expliciet aangezet via LOG_ZOEKTERMEN=1 (alleen voor debug).
 */
import { trace } from "@opentelemetry/api";
const NIVEAUS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function drempelNiveau() {
    const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
    return NIVEAUS[env] ?? NIVEAUS.info;
}
/** Veldnamen die nooit in een logregel mogen verschijnen (defence-in-depth). */
const GEHEIME_VELDEN = new Set(["authorization", "token", "bearer", "secret", "password"]);
/** Strip geheime velden voordat een object wordt geserialiseerd. */
function saneer(velden) {
    const schoon = {};
    for (const [k, v] of Object.entries(velden)) {
        if (GEHEIME_VELDEN.has(k.toLowerCase()))
            continue;
        if (v === undefined)
            continue;
        schoon[k] = v;
    }
    return schoon;
}
/** `{trace_id, span_id}` van de actieve OTel-span, of leeg als er geen (geldige) span is. */
function traceContext() {
    try {
        const span = trace.getActiveSpan();
        if (!span)
            return {};
        const ctx = span.spanContext();
        if (!ctx || !ctx.traceId || ctx.traceId === "00000000000000000000000000000000")
            return {};
        return { trace_id: ctx.traceId, span_id: ctx.spanId };
    }
    catch {
        return {};
    }
}
/**
 * Schrijf één gestructureerde logregel naar stderr.
 * Faalt nooit hard: logging mag de request-afhandeling niet kunnen breken.
 */
export function log(niveau, categorie, bericht, velden = {}) {
    if (NIVEAUS[niveau] < drempelNiveau())
        return;
    try {
        const regel = {
            ts: new Date().toISOString(), // UTC
            niveau,
            categorie,
            bericht,
            ...traceContext(),
            ...saneer(velden),
        };
        process.stderr.write(JSON.stringify(regel) + "\n");
    }
    catch {
        /* nooit laten omvallen op een logfout */
    }
}
/**
 * Maak tool-argumenten veilig voor de auditlog: behoud de niet-gevoelige,
 * traceerbare velden (BWB-id, artikel, lid, peildatum, titel) en **redacteer de
 * zoekterm** standaard tot lengte (AVG-dataminimalisatie). Zet LOG_ZOEKTERMEN=1
 * om de volledige term te loggen — uitsluitend voor debug.
 */
export function veiligeToolVelden(args) {
    if (typeof args !== "object" || args === null)
        return {};
    const a = args;
    const uit = {};
    for (const veld of ["bwbId", "artikel", "lid", "peildatum", "titel", "rechtsgebied", "ministerie", "regelingsoort"]) {
        if (a[veld] !== undefined)
            uit[veld] = a[veld];
    }
    if (typeof a.zoekterm === "string") {
        if (process.env.LOG_ZOEKTERMEN === "1") {
            uit.zoekterm = a.zoekterm;
        }
        else {
            uit.zoekterm_lengte = a.zoekterm.length;
            uit.zoekterm = "[geredacteerd]";
        }
    }
    return uit;
}
