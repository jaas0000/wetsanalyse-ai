import type { Metadata, Viewport } from "next";
import { auth } from "@/auth";
import { AppMain } from "@/components/AppMain";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="nl" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers session={session}>
          <SiteHeader ingelogd={!!session} />
          <AppMain>{children}</AppMain>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
