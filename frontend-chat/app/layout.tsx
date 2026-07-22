import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juridische Assistent · Belastingdienst",
  description: "Brongetrouw juridisch vragen beantwoorden via de kennisgraaf.",
};

export const viewport: Viewport = { themeColor: "#020B18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
