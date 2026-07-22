// Publieke stap A van login: verificeer userid+wachtwoord bij de API zonder sessie te zetten.
import { postAuthVerify } from "@/lib/server";
import { getTrustedDeviceCookie, setLoginTicketCookie } from "@/lib/authCookies";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userid, password } = (await req.json().catch(() => ({}))) as {
    userid?: string;
    password?: string;
  };
  const trusted_token = (await getTrustedDeviceCookie()) ?? null;
  const { status, body } = await postAuthVerify({
    userid: userid ?? "",
    password: password ?? "",
    trusted_token,
  });
  if (body.code === "totp_required" && body.ticket) {
    await setLoginTicketCookie(body.ticket);
  }
  return Response.json(
    { ok: body.ok, code: body.code, userid: userid ?? "", email: body.email, role: body.role },
    { status: status === 429 ? 429 : 200 }
  );
}
