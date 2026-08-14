import type { Metadata, Viewport } from "next";
import { auth } from "@/auth";
import { Providers } from "@/components/Providers";
import { sans, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wetsanalyse | Belastingdienst",
  description:
    "Gestructureerd, brongetrouw en traceerbaar duiden van Nederlandse wet- en regelgeving (JAS).",
  manifest: "/manifest.webmanifest",
  applicationName: "Wetsanalyse | Belastingdienst",
  appleWebApp: { capable: true, title: "Wetsanalyse", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#154273",
};

/** De layout is bewust kaal: er is geen globale chrome meer. Elk scherm draagt zijn eigen kader —
 *  ingelogd is dat de app-schil (`/workbench`, `/instellingen`), uitgelogd de gecentreerde kaart van
 *  `AuthFrame`. De oude logobalk + navigatiebalk + footer zijn weg: die navigatie wees naar plekken
 *  die inmiddels ín de schil zitten, en de kop verborg zichzelf toch al op de app-paden.
 *
 *  `modal` is het parallelle slot dat de intercepting routes vullen (app/@modal/**); dat staat
 *  buiten `{children}`, want een dialog hoort over de hele app heen te liggen. */
export default async function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="nl" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers session={session}>
          {children}
          {modal}
        </Providers>
      </body>
    </html>
  );
}
