// Volledige Auth.js-setup (Node-runtime): de Credentials-provider verifieert e-mail + wachtwoord
// (+ optionele TOTP) server→server tegen de API. De API is de identiteitsbron; Auth.js houdt
// alleen de browsersessie (httpOnly cookie, JWT-strategie). Het API-token blijft server-side
// (via lib/server.ts) en komt nooit in de browser.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig, type Role } from "./auth.config";
import { verifyCredentials } from "@/lib/server";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
        if (!userid || !password) return null;
        const res = await verifyCredentials(userid, password, totp);
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
