// Server-side configuratie voor de chat-app.
// NOOIT importeren vanuit een Client Component — bevat tokens.
import "server-only";
import { readFileSync } from "node:fs";

let _qaToken: string | null = null;
let _apiToken: string | null = null;

function readEnvOrFile(envFile: string, envVal: string, cache: string | null): string {
  if (cache !== null) return cache;
  const file = process.env[envFile];
  if (file) {
    try { return readFileSync(file, "utf8").trim(); }
    catch (e) { throw new Error(`Kan ${envFile} niet lezen: ${(e as Error).message}`); }
  }
  return (process.env[envVal] || "").trim();
}

// --- Graph-QA (chat-agent) --------------------------------------------------

export function chatApiBaseUrl(): string {
  return (process.env.CHAT_API_URL || "http://graph-qa:8080").replace(/\/+$/, "");
}

export function chatApiToken(): string {
  return (_qaToken ??= readEnvOrFile("CHAT_API_TOKEN_FILE", "CHAT_API_TOKEN", null));
}

export function chatAuthHeader(): Record<string, string> {
  const t = chatApiToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// --- Wetsanalyse API (voor auth) --------------------------------------------

export function apiBaseUrl(): string {
  return (process.env.API_BASE_URL || "http://wetsanalyse-api:3000").replace(/\/+$/, "");
}

export function apiToken(): string {
  return (_apiToken ??= readEnvOrFile("API_TOKEN_FILE", "API_TOKEN", null));
}

export function apiAuthHeader(): Record<string, string> {
  const t = apiToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
