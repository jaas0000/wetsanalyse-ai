// Publieke pre-check vóór de eigenlijke login: vraagt de API of deze inloggegevens kloppen en of
// 2FA vereist is (code "totp_required"), zodat het loginscherm het 2FA-veld pas tóónt wanneer nodig.
// Zet géén sessie — dat doet Auth.js (signIn) pas ná een geslaagde check. De API rate-limit't /verify
// per e-mail tegen brute-force.
import { proxy, readBody } from "../_lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readBody(req);
  return proxy(`/v1/auth/verify`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}
