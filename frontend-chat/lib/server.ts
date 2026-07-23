// Server-only helpers: praten rechtstreeks (server→server) met de wetsanalyse-API voor auth.
import "server-only";
import { apiBaseUrl, apiAuthHeader } from "./config";
import { logger } from "./logger";

export interface VerifyResult {
  ok: boolean;
  code: string;
  userid: string;
  email: string;
  role: "beheerder" | "analist" | "";
  ticket?: string | null;
  trusted_token?: string | null;
}

export interface AccountStatus {
  status: "actief" | "ingetrokken" | "onbekend";
  role: "beheerder" | "analist" | "";
  email: string;
}

export async function postAuthVerify(payload: Record<string, unknown>): Promise<{ status: number; body: VerifyResult }> {
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/verify`, {
      method: "POST",
      headers: { ...apiAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const raw = (await res.json().catch(() => ({}))) as Partial<VerifyResult>;
    const body: VerifyResult = { ok: false, code: "", userid: "", email: "", role: "", ...raw };
    return { status: res.status, body };
  } catch (err) {
    logger.warn("Auth-verify: API onbereikbaar", { fout: (err as Error).message });
    return { status: 503, body: { ok: false, code: "unavailable", userid: "", email: "", role: "" } };
  }
}

export async function verifyCredentials(
  userid: string,
  password: string,
  totp?: string,
  opts?: { ticket?: string | null; trusted_token?: string | null }
): Promise<VerifyResult> {
  const { body } = await postAuthVerify({ userid, password, totp, ...opts });
  return body;
}

export async function getAccountStatus(userid: string): Promise<AccountStatus> {
  // GET /v1/auth/me — geeft userid/email/role terug op basis van X-User-Id header.
  // /v1/auth/status/{userid} bestaat niet in de API; /v1/auth/me is het correcte
  // herverificatie-endpoint. De X-User-Id header wordt server-side gezet (nooit uit browser-input).
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/me`, {
      headers: { ...apiAuthHeader(), "X-User-Id": userid },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // 401 = account ingetrokken of onbekend; andere fouten = tijdelijk onbereikbaar
      if (res.status === 401) return { status: "ingetrokken", role: "", email: "" };
      logger.warn("Auth-status: niet-ok", { http_status: res.status });
      return { status: "onbekend", role: "", email: "" };
    }
    const data = (await res.json()) as { userid: string; email: string; role: string };
    return {
      status: "actief",
      role: (data.role as "beheerder" | "analist") || "",
      email: data.email || "",
    };
  } catch {
    return { status: "onbekend", role: "", email: "" };
  }
}

export async function getMe(userid: string): Promise<{ userid: string; email: string; role: string; name?: string } | null> {
  // GET /v1/auth/me met X-User-Id header — hetzelfde endpoint als getAccountStatus
  // maar retourneert het ruwe object voor gebruik buiten de auth-callback.
  // NB: /v1/users/{userid} (zonder /admin) bestaat niet; de admin-route is /v1/admin/users.
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/me`, {
      headers: { ...apiAuthHeader(), "X-User-Id": userid },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("Profiel: niet-ok", { http_status: res.status });
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}
