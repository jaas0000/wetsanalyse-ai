"use client";

// Vangt fouten die de root-layout zelf raken. Vervangt de hele document-boom, dus met eigen
// <html>/<body> en inline stijl (de app-styling is hier mogelijk niet geladen).

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="nl">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1rem", color: "#1C1A17", background: "#F6F3EC" }}>
        <main style={{ maxWidth: "40rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.25rem" }}>Er ging iets mis</h1>
          <p style={{ color: "#5C564C" }}>
            De applicatie kon niet worden geladen. Probeer het opnieuw of ververs de pagina.
          </p>
          {error.digest && <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#8A8377" }}>Referentie: {error.digest}</p>}
          <button
            onClick={() => reset()}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: "0.375rem", border: "none", background: "#7A2E2E", color: "#F6F3EC", cursor: "pointer" }}
          >
            Opnieuw proberen
          </button>
        </main>
      </body>
    </html>
  );
}
