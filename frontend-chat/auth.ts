import NextAuth from "next-auth";
import { encode } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { authConfig, SESSIE_KORT, SESSIE_LANG, type Role } from "./auth.config";
import { getAccountStatus, verifyCredentials } from "@/lib/server";
import { getLoginTicketCookie, getTrustedDeviceCookie } from "@/lib/authCookies";

const HERVERIFICATIE_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  jwt: {
    maxAge: SESSIE_LANG,
    encode: (params) =>
      encode({ ...params, maxAge: params.token?.rememberMe === true ? SESSIE_LANG : SESSIE_KORT }),
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.userid = (user as { userid?: string }).userid;
        token.role = (user as { role?: Role }).role;
        token.email = user.email;
        token.rememberMe = (user as { rememberMe?: boolean }).rememberMe === true;
        token.verifiedAt = Date.now();
        return token;
      }
      const verifiedAt = typeof token.verifiedAt === "number" ? token.verifiedAt : 0;
      if (!token.userid || Date.now() - verifiedAt < HERVERIFICATIE_MS) return token;
      const status = await getAccountStatus(String(token.userid));
      if (status.status === "ingetrokken") return null;
      if (status.status === "actief") {
        token.role = status.role;
        token.email = status.email;
        token.verifiedAt = Date.now();
      }
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        userid: { label: "Gebruikersnaam", type: "text" },
        password: { label: "Wachtwoord", type: "password" },
        totp: { label: "2FA-code", type: "text" },
        remember: { label: "Ingelogd blijven", type: "text" },
      },
      async authorize(credentials) {
        const userid = String(credentials?.userid ?? "");
        const password = String(credentials?.password ?? "");
        const totp = credentials?.totp ? String(credentials.totp) : undefined;
        const remember = credentials?.remember === "1";
        if (!userid) return null;
        const ticket = (await getLoginTicketCookie()) ?? null;
        const trusted_token = (await getTrustedDeviceCookie()) ?? null;
        if (!password && !ticket) return null;
        const res = await verifyCredentials(userid, password, totp, { ticket, trusted_token });
        if (!res.ok) return null;
        return {
          id: res.userid,
          userid: res.userid,
          name: res.userid,
          email: res.email,
          role: res.role as Role,
          rememberMe: remember,
        };
      },
    }),
  ],
});
