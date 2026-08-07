import type { Metadata } from "next";
import { BerichtenArchiefClient } from "./BerichtenArchiefClient";

export const metadata: Metadata = { title: "Berichten · Wetsanalyse" };

export default function BerichtenPagina() {
  return (
    <div className="animate-rise mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-lint">Berichten</h1>
        <p className="mt-1 text-sm text-muted">Release notes en aankondigingen.</p>
      </div>
      <BerichtenArchiefClient />
    </div>
  );
}
