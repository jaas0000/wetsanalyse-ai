// httpOnly-cookie helpers — server-side only (Next.js cookies()).
import "server-only";
import { cookies } from "next/headers";

const TICKET_NAME = "chat_login_ticket";
const TRUSTED_NAME = "chat_trusted_device";
const MAX_AGE_TICKET = 5 * 60; // 5 min
const MAX_AGE_TRUSTED = 30 * 24 * 60 * 60; // 30 dagen

export async function getLoginTicketCookie(): Promise<string | undefined> {
  return (await cookies()).get(TICKET_NAME)?.value;
}

export async function setLoginTicketCookie(ticket: string): Promise<void> {
  (await cookies()).set(TICKET_NAME, ticket, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_TICKET,
  });
}

export async function getTrustedDeviceCookie(): Promise<string | undefined> {
  return (await cookies()).get(TRUSTED_NAME)?.value;
}

export async function setTrustedDeviceCookie(token: string): Promise<void> {
  (await cookies()).set(TRUSTED_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_TRUSTED,
  });
}
