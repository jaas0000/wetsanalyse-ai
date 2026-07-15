// Edge-veilige Auth.js-config (geen Node-only imports) — gedeeld door de middleware en de volledige
// `auth.ts`. De middleware bundelt dit voor de edge-runtime, dus hier géén `lib/server.ts`/
// `lib/config.ts` (die lezen secrets via node:fs). De providers met hun authorize-logica zitten
// alleen in `auth.ts`; hier staat de route-gate (`authorized`) en het sessie-/JWT-vormgeven.

import type { NextAuthConfig } from "next-auth";

export type Role = "beheerder" | "analist";

// Sessieduur (JWT-strategie). De cookie-/bovengrens is de lange duur; de effectieve levensduur per
// login wordt in auth.ts (custom jwt.encode) op LANG of KORT gezet, afhankelijk van de keuze
// "Ingelogd blijven op dit apparaat" (token.rememberMe).
export const SESSIE_LANG = 30 * 24 * 60 * 60; // 30 dagen (onthouden)
export const SESSIE_KORT = 12 * 60 * 60; // 12 uur (niet onthouden)

// Paden die zonder sessie bereikbaar moeten zijn (login, eenmalige registratie + hun BFF-routes,
// en de health-check voor Docker/NPM/CI — die mag nooit achter de login vallen).
function isPublic(path: string): boolean {
  return (
    path === "/login" ||
    path === "/login/2fa" ||
    path === "/setup" ||
    path === "/api/setup" ||
    path === "/api/login-verify" ||
    path === "/api/login-2fa" ||
    path === "/api/health"
  );
}

// Muterende methodes waarop de Origin-check geldt (CSRF defense-in-depth naast SameSite=Lax).
const MUTEREND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const authConfig = {
  // De app draait achter Nginx Proxy Manager; vertrouw de forward-headers voor de callback-host.
  trustHost: true,
  pages: { signIn: "/login" },
  // Rollende sessie. maxAge is de bovengrens/cookie-levensduur (30 d); de effectieve JWT-levensduur
  // per login (30 d bij "ingelogd blijven", anders 12 u) zet de custom jwt.encode in auth.ts. Een
  // gedeactiveerde/gedegradeerde gebruiker verliest z'n toegang veel sneller: de jwt-callback in
  // auth.ts herverifieert elke ~5 min tegen de API bij elke server-side auth().
  session: { strategy: "jwt", maxAge: SESSIE_LANG, updateAge: 24 * 60 * 60 },
  // Cookie-flags expliciet (defense-in-depth; dit zijn de Auth.js-defaults, maar vastgelegd
  // zodat een library-upgrade ze niet stil kan versoepelen).
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    // Draait voor elk door de middleware-matcher geraakt request: bepaalt toegang + rol-gate.
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const path = nextUrl.pathname;
      // CSRF defense-in-depth naast SameSite=Lax: een muterende BFF-call moet van de eigen
      // origin komen. Alleen afgedwongen als de browser een Origin-header meestuurt (fetch/POST
      // doet dat altijd; header-loze server-side calls vallen terug op SameSite). Auth.js' eigen
      // /api/auth/* heeft al een CSRF-token en valt buiten de middleware-matcher.
      if (path.startsWith("/api/") && MUTEREND.has(request.method)) {
        const origin = request.headers.get("origin");
        if (origin) {
          let originHost: string | null = null;
          try {
            originHost = new URL(origin).host;
          } catch {
            originHost = null;
          }
          // LET OP: `x-forwarded-host` wordt hier vertrouwd. Dat is veilig achter de Nginx Proxy
          // Manager (die de header autoritair zet), maar hard afhankelijk van die proxy: stel de app
          // nooit direct (zonder proxy) bloot, anders kan een client de Origin-check omzeilen door
          // zelf een `x-forwarded-host` gelijk aan zijn Origin mee te sturen.
          const eigenHosts = new Set(
            [nextUrl.host, request.headers.get("x-forwarded-host")].filter(Boolean),
          );
          if (!originHost || !eigenHosts.has(originHost)) {
            return Response.json({ detail: "Origin niet toegestaan." }, { status: 403 });
          }
        }
      }
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
        token.rememberMe = (user as { rememberMe?: boolean }).rememberMe === true;
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
