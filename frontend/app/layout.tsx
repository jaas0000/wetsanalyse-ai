import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wetsanalyse",
  description:
    "Gestructureerd, brongetrouw en traceerbaar duiden van Nederlandse wet- en regelgeving (JAS).",
  manifest: "/manifest.webmanifest",
  applicationName: "Wetsanalyse",
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
  themeColor: "#01689b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <header className="border-b border-line/80 bg-surface/70 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="group flex items-baseline gap-3">
              <span className="font-display text-xl font-semibold tracking-tight text-ink">
                Wetsanalyse
              </span>
              <span className="hidden text-xs uppercase tracking-[0.2em] text-faint sm:inline">
                JAS · brongetrouw
              </span>
            </Link>
            <nav className="flex shrink-0 items-center gap-2 text-sm">
              <Link
                href="/"
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-paper hover:text-ink"
              >
                Projecten
              </Link>
              <Link
                href="/nieuw"
                className="whitespace-nowrap rounded-md bg-accent px-3 py-1.5 font-medium text-paper transition-colors hover:bg-accent-soft"
              >
                Nieuwe analyse
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs text-faint">
          Methode Wetsanalyse (Ausems, Bulles &amp; Lokin) · Juridisch Analyseschema · brongetrouw
          herleidbaar naar artikel, lid en bronreferentie.
        </footer>
      </body>
    </html>
  );
}
