// Type-uitbreiding: de userid (inlog-identiteit) + rol op de sessie/JWT/user (zie auth.config.ts).
import type { Role } from "@/auth.config";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { userid?: string; role?: Role } & DefaultSession["user"];
  }
  interface User {
    userid?: string;
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userid?: string;
    role?: Role;
  }
}
