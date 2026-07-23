import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juridische Assistent · Belastingdienst",
  description: "Brongetrouw juridisch vragen beantwoorden via de kennisgraaf.",
  // favicon.ico, icon.png en apple-icon.png in app/ worden door Next.js
  // automatisch opgepikt als <link rel="icon"> / <link rel="apple-touch-icon">.
  // manifest wordt geserveerd via app/manifest.ts (route handler, werkt in standalone).
};

export const viewport: Viewport = { themeColor: "#020B18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}

