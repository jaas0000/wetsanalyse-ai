// Edge-veilige Auth.js-config — gedeeld door middleware en auth.ts.
// Geen Node-only imports hier (geen lib/server.ts, lib/config.ts).
import type { NextAuthConfig } from "next-auth";

export type Role = "beheerder" | "analist";

export const SESSIE_LANG = 30 * 24 * 60 * 60; // 30 dagen
export const SESSIE_KORT = 12 * 60 * 60;        // 12 uur

function isPublic(path: string): boolean {
  return (
    path === "/login" ||
    path === "/login/2fa" ||
    path.startsWith("/api/auth") ||
    path === "/api/login-verify" ||
    path === "/api/login-2fa" ||
    path === "/api/health"
  );
}

const MUTEREND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: SESSIE_LANG, updateAge: 24 * 60 * 60 },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const path = nextUrl.pathname;

      // CSRF defense-in-depth
      if (path.startsWith("/api/") && MUTEREND.has(request.method)) {
        const origin = request.headers.get("origin");
        if (origin) {
          let originHost: string | null = null;
          try { originHost = new URL(origin).host; } catch { originHost = null; }
          const eigenHosts = new Set(
            [nextUrl.host, request.headers.get("x-forwarded-host")].filter(Boolean)
          );
          if (!originHost || !eigenHosts.has(originHost)) {
            return Response.json({ detail: "Origin niet toegestaan." }, { status: 403 });
          }
        }
      }

      if (isPublic(path)) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.userid = (user as { userid?: string }).userid;
        token.role = (user as { role?: Role }).role;
        token.email = user.email;
        token.rememberMe = (user as { rememberMe?: boolean }).rememberMe === true;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { userid?: string }).userid = token.userid as string | undefined;
        (session.user as { role?: Role }).role = token.role as Role | undefined;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
