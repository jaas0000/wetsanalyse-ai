import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Juridische Assistent",
    short_name: "JA · BD",
    description: "Brongetrouw juridisch vragen beantwoorden via de kennisgraaf van de Belastingdienst.",
    start_url: "/chat",
    display: "standalone",
    background_color: "#020B18",
    theme_color: "#020B18",
    icons: [
      { src: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
