import { WerkplekClient } from "@/components/werkplek/WerkplekClient";

export const metadata = { title: "Assistent · Wetsanalyse" };

export default function WerkplekPagina() {
  return (
    <div className="animate-rise mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-lint">Assistent</h1>
        <p className="mt-1 text-sm text-muted">
          Stel vragen over de wet- en regelgeving én laat de agent artikelen volgens het JAS annoteren —
          in één gesprek. Antwoorden komen brongetrouw uit de kennisgraaf; annotaties verschijnen als
          reviewbare kaarten (akkoord / aanpassen / verwerpen / opmerking) met alleen letterlijke
          fragmenten uit de wettekst.
        </p>
      </div>
      <WerkplekClient />
    </div>
  );
}
