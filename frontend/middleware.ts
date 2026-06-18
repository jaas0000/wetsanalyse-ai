// Route-bescherming: bewaakt élke pagina + BFF-route (behalve login/setup/auth en assets) via de
// edge-veilige authConfig. De `authorized`-callback (auth.config.ts) bepaalt toegang en de rol-gate
// op /beheer en /api/admin.

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Sluit Auth.js' eigen routes, Next-interne paden en statische bestanden uit.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webmanifest)).*)",
  ],
};
