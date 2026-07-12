// Volledige Auth.js-setup (Node-runtime): de Credentials-provider verifieert e-mail + wachtwoord
// (+ optionele TOTP) server→server tegen de API. De API is de identiteitsbron; Auth.js houdt
// alleen de browsersessie (httpOnly cookie, JWT-strategie). Het API-token blijft server-side
// (via lib/server.ts) en komt nooit in de browser.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig, type Role } from "./auth.config";
import { getAccountStatus, verifyCredentials } from "@/lib/server";
import { getLoginTicketCookie, getTrustedDeviceCookie } from "@/lib/authCookies";

// Hoe lang een JWT op de laatste verificatie mag teren voordat we de accountstatus opnieuw
// bij de API checken. Samen met session.maxAge (auth.config.ts) begrenst dit hoe lang een
// gedeactiveerde/gedegradeerde gebruiker nog toegang houdt.
const HERVERIFICATIE_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Node-runtime-variant van de jwt-callback: als auth.config.ts, plus periodieke
    // herverificatie tegen de API (revocatie + rolwijziging). De edge-middleware gebruikt de
    // lichte variant zonder herverificatie (lib/server.ts is node-only); elke auth()-aanroep
    // in Server Components en route handlers loopt wél langs deze versie.
    async jwt({ token, user }) {
      if (user) {
        token.userid = (user as { userid?: string }).userid;
        token.role = (user as { role?: Role }).role;
        token.email = user.email;
        token.verifiedAt = Date.now();
        return token;
      }
      const verifiedAt = typeof token.verifiedAt === "number" ? token.verifiedAt : 0;
      if (!token.userid || Date.now() - verifiedAt < HERVERIFICATIE_MS) return token;
      const status = await getAccountStatus(String(token.userid));
      if (status.status === "ingetrokken") return null; // sessie invalideren
      if (status.status === "actief") {
        token.role = status.role; // rolwijziging (bv. degradatie) meteen doorvoeren
        token.email = status.email;
        token.verifiedAt = Date.now();
      }
      return token; // "onbekend" (API-hapering): laten staan; maxAge begrenst het venster
    },
  },
  providers: [
    Credentials({
      credentials: {
        userid: { label: "Gebruikersnaam", type: "text" },
        password: { label: "Wachtwoord", type: "password" },
        totp: { label: "2FA-code", type: "text" },
      },
      async authorize(credentials) {
        const userid = String(credentials?.userid ?? "");
        const password = String(credentials?.password ?? "");
        const totp = credentials?.totp ? String(credentials.totp) : undefined;
        if (!userid) return null;
        // Bewijzen uit de httpOnly cookies (server-side): het login-ticket vervangt het wachtwoord op
        // het aparte 2FA-scherm; de trusted-device-cookie slaat bij een 2FA-account de TOTP over.
        const ticket = (await getLoginTicketCookie()) ?? null;
        const trusted_token = (await getTrustedDeviceCookie()) ?? null;
        // Wachtwoord óf een geldig login-ticket is vereist.
        if (!password && !ticket) return null;
        const res = await verifyCredentials(userid, password, totp, { ticket, trusted_token });
        if (!res.ok) {
          // Bij rate-limiting (code "rate") of foutieve gegevens retourneert null zodat Auth.js
          // de sessie weigert. De loginVerify-precheck in LoginClient toont de specifieke
          // rate-limit-melding; dit pad is de veiligheidsnet-verificatie.
          return null;
        }
        // Userid + rol reizen mee naar het JWT (zie jwt-callback). Bij ok is role nooit "".
        return { id: res.userid, userid: res.userid, name: res.userid, email: res.email, role: res.role as Role };
      },
    }),
  ],
});
