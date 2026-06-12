/**
 * Authenticatie voor het HTTP-transport — **per-client bearer-tokens**.
 *
 * Reden (BIO2 / ISO 27002:2022, 5.16 identiteitsbeheer + 8.5 secure authentication):
 * één gedeelde token geeft geen identiteit per afnemer en is niet per client
 * intrekbaar/roteerbaar. Met `id:token`-paren krijgt elke afnemer een eigen token,
 * verschijnt zijn `clientId` in de auditlog, en kan één client worden ingetrokken
 * zonder de rest te raken.
 *
 * Configuratie (env):
 *   MCP_AUTH_TOKENS = "belastingdienst:abc123, analist-jan:def456"
 *      Komma- of newline-gescheiden lijst van `id:token`-paren.
 *   MCP_AUTH_TOKEN  = "abc123"   (legacy, enkelvoud → clientId "default")
 *
 * Secret-management (BIO2 / ISO 27002:2022 §8.24 + §5.17): in plaats van de token
 * als plain env mee te geven, kan hij uit een **bestand** worden gelezen. Dat is het
 * standaardpatroon voor Docker secrets en vault-agents (secret als file gemount):
 *   MCP_AUTH_TOKENS_FILE = "/run/secrets/mcp_tokens"
 *   MCP_AUTH_TOKEN_FILE  = "/run/secrets/mcp_token"   (legacy enkelvoud)
 * De *_FILE-variant heeft voorrang op de gelijknamige inline env.
 *
 * Tokenvergelijking is constant-tijd om een timing-oracle te voorkomen.
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { log } from "./logger.js";
/** Lees een waarde uit een bestand (*_FILE) als dat is gezet, anders de inline env. */
function envOfBestand(env, naam) {
    const pad = env[`${naam}_FILE`];
    if (pad && pad.trim()) {
        try {
            return readFileSync(pad.trim(), "utf8");
        }
        catch (err) {
            // Fail-closed elders: een onleesbaar secret levert geen clients op.
            console.error(`Kon secret-bestand niet lezen (${naam}_FILE): ${err.message}`);
            return undefined;
        }
    }
    return env[naam];
}
/** Constant-tijd vergelijking van twee strings (lengteverschil lekt enkel de lengte). */
export function veiligGelijk(a, b) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length)
        return false;
    return timingSafeEqual(ba, bb);
}
/**
 * Lees de geconfigureerde clients uit de omgeving.
 * Combineert MCP_AUTH_TOKENS (meervoud) met de legacy MCP_AUTH_TOKEN (enkelvoud).
 * Ongeldige/lege paren worden genegeerd.
 */
export function leesClients(env = process.env) {
    const clients = [];
    const gezien = new Set();
    const ruw = envOfBestand(env, "MCP_AUTH_TOKENS") ?? "";
    let kaalIndex = 0;
    for (const deel of ruw.split(/[,\n]/)) {
        const trimmed = deel.trim();
        if (!trimmed)
            continue;
        const scheiding = trimmed.indexOf(":");
        let id;
        let token;
        if (scheiding > 0) {
            id = trimmed.slice(0, scheiding).trim();
            token = trimmed.slice(scheiding + 1).trim();
        }
        else {
            // Geen id-prefix → behandel als kale token (backward-compat met MCP_AUTH_TOKEN).
            // Voorkomt een fail-closed outage als de stack-env nog een kale token bevat.
            token = scheiding === 0 ? trimmed.slice(1).trim() : trimmed;
            id = kaalIndex === 0 ? "default" : `client${kaalIndex + 1}`;
            kaalIndex++;
            // Zichtbaar maken: een vergeten id-prefix (typfout) zou anders stilzwijgend
            // een werkende, anonieme token opleveren i.p.v. een herkenbare configfout.
            log("warn", "security", "kale token zonder id-prefix in MCP_AUTH_TOKENS", {
                toegewezen_clientId: id,
            });
        }
        if (!id || !token || gezien.has(id))
            continue;
        gezien.add(id);
        clients.push({ id, token });
    }
    const legacy = envOfBestand(env, "MCP_AUTH_TOKEN")?.trim();
    if (legacy && !gezien.has("default")) {
        clients.push({ id: "default", token: legacy });
    }
    return clients;
}
/**
 * Authenticeer een `Authorization`-header tegen de bekende clients.
 * Retourneert de `clientId` bij succes, anders null. Vergelijkt constant-tijd
 * tegen álle clients (geen vroege return) zodat de looptijd niet verraadt wélke
 * token bijna klopte.
 */
export function authenticeer(authorizationHeader, clients) {
    const aangeboden = authorizationHeader ?? "";
    let gevonden = null;
    for (const client of clients) {
        if (veiligGelijk(aangeboden, `Bearer ${client.token}`)) {
            gevonden = client.id;
        }
    }
    return gevonden;
}
