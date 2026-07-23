import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juridische Assistent · Belastingdienst",
  description: "Brongetrouw juridisch vragen beantwoorden via de kennisgraaf.",
  icons: {
    // Standaard favicon — browsers kiezen zelf de beste maat
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    // iOS — "Voeg toe aan beginscherm"
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    // Android / PWA shortcut icon
    other: [
      { rel: "icon", url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#020B18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
