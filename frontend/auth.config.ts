// Edge-veilige Auth.js-config (geen Node-only imports) — gedeeld door de middleware en de volledige
// `auth.ts`. De middleware bundelt dit voor de edge-runtime, dus hier géén `lib/server.ts`/
// `lib/config.ts` (die lezen secrets via node:fs). De providers met hun authorize-logica zitten
// alleen in `auth.ts`; hier staat de route-gate (`authorized`) en het sessie-/JWT-vormgeven.

import type { NextAuthConfig } from "next-auth";

export type Role = "beheerder" | "analist";

// Paden die zonder sessie bereikbaar moeten zijn (login, eenmalige registratie + hun BFF-routes,
// en de health-check voor Docker/NPM/CI — die mag nooit achter de login vallen).
function isPublic(path: string): boolean {
  return (
    path === "/login" ||
    path === "/setup" ||
    path === "/api/setup" ||
    path === "/api/login-verify" ||
    path === "/api/health"
  );
}

export const authConfig = {
  // De app draait achter Nginx Proxy Manager; vertrouw de forward-headers voor de callback-host.
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    // Draait voor elk door de middleware-matcher geraakt request: bepaalt toegang + rol-gate.
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname;
      if (isPublic(path)) return true;
      const user = auth?.user;
      if (!user) return false; // → redirect naar de signIn-pagina (/login)
      // Alleen beheerders mogen /beheer en de admin-BFF-routes.
      const role = (user as { role?: Role }).role;
      if ((path.startsWith("/beheer") || path.startsWith("/api/admin")) && role !== "beheerder") {
        return Response.redirect(new URL("/", nextUrl));
      }
      return true;
    },
    // Userid (inlog-identiteit) + rol + e-mail in het JWT bewaren (Credentials → JWT-sessie).
    jwt({ token, user }) {
      if (user) {
        token.userid = (user as { userid?: string }).userid;
        token.role = (user as { role?: Role }).role;
        token.email = user.email;
      }
      return token;
    },
    // Userid + rol uit het JWT op de sessie zetten zodat de UI ze kan lezen.
    session({ session, token }) {
      if (session.user) {
        (session.user as { userid?: string }).userid = token.userid as string | undefined;
        (session.user as { role?: Role }).role = token.role as Role | undefined;
      }
      return session;
    },
  },
  providers: [], // gevuld in auth.ts (Credentials); leeg hier zodat de edge-bundel licht blijft
} satisfies NextAuthConfig;
