// Server-only helpers: praten rechtstreeks (server→server) met de wetsanalyse-API voor auth.
import "server-only";
import { apiBaseUrl, apiAuthHeader } from "./config";

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
    });
    const raw = (await res.json().catch(() => ({}))) as Partial<VerifyResult>;
    const body: VerifyResult = { ok: false, code: "", userid: "", email: "", role: "", ...raw };
    return { status: res.status, body };
  } catch {
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
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/auth/status/${encodeURIComponent(userid)}`, {
      headers: apiAuthHeader(),
      cache: "no-store",
    });
    if (!res.ok) return { status: "onbekend", role: "", email: "" };
    return (await res.json()) as AccountStatus;
  } catch {
    return { status: "onbekend", role: "", email: "" };
  }
}

export async function getMe(userid: string): Promise<{ userid: string; email: string; role: string; name?: string } | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/users/${encodeURIComponent(userid)}`, {
      headers: apiAuthHeader(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
