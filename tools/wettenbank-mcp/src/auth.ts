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
 * Tokenvergelijking is constant-tijd om een timing-oracle te voorkomen.
 */

import { timingSafeEqual } from "node:crypto";

export interface ClientToken {
  id: string;
  token: string;
}

/** Constant-tijd vergelijking van twee strings (lengteverschil lekt enkel de lengte). */
export function veiligGelijk(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Lees de geconfigureerde clients uit de omgeving.
 * Combineert MCP_AUTH_TOKENS (meervoud) met de legacy MCP_AUTH_TOKEN (enkelvoud).
 * Ongeldige/lege paren worden genegeerd.
 */
export function leesClients(env: NodeJS.ProcessEnv = process.env): ClientToken[] {
  const clients: ClientToken[] = [];
  const gezien = new Set<string>();

  const ruw = env.MCP_AUTH_TOKENS ?? "";
  let kaalIndex = 0;
  for (const deel of ruw.split(/[,\n]/)) {
    const trimmed = deel.trim();
    if (!trimmed) continue;
    const scheiding = trimmed.indexOf(":");
    let id: string;
    let token: string;
    if (scheiding > 0) {
      id = trimmed.slice(0, scheiding).trim();
      token = trimmed.slice(scheiding + 1).trim();
    } else {
      // Geen id-prefix → behandel als kale token (backward-compat met MCP_AUTH_TOKEN).
      // Voorkomt een fail-closed outage als de stack-env nog een kale token bevat.
      token = scheiding === 0 ? trimmed.slice(1).trim() : trimmed;
      id = kaalIndex === 0 ? "default" : `client${kaalIndex + 1}`;
      kaalIndex++;
    }
    if (!id || !token || gezien.has(id)) continue;
    gezien.add(id);
    clients.push({ id, token });
  }

  const legacy = env.MCP_AUTH_TOKEN?.trim();
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
export function authenticeer(
  authorizationHeader: string | undefined,
  clients: ClientToken[]
): string | null {
  const aangeboden = authorizationHeader ?? "";
  let gevonden: string | null = null;
  for (const client of clients) {
    if (veiligGelijk(aangeboden, `Bearer ${client.token}`)) {
      gevonden = client.id;
    }
  }
  return gevonden;
}
