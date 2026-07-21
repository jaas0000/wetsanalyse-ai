import { WorkbenchClient } from "@/components/workbench/WorkbenchClient";

export const metadata = { title: "Workbench · Wetsanalyse" };

export default function WorkbenchPagina() {
  return (
    <div className="animate-rise mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-lint">Annotatie-workbench</h1>
        <p className="mt-1 text-sm text-muted">
          De agent stelt JAS-elementen voor op een wetsartikel; jij reviewt elk voorstel (akkoord /
          aanpassen / verwerpen / opmerking). Brongetrouw — alleen letterlijke fragmenten uit de
          artikeltekst.
        </p>
      </div>
      <WorkbenchClient />
    </div>
  );
}
