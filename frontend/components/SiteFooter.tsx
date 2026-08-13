"use client";

import { usePathname } from "next/navigation";

import { isAppShellPad } from "@/lib/appShell";

/** Globale site-footer. Weggelaten op de app-shell-paden (`/workbench`, `/instellingen`): dat zijn
 *  vol-hoogte schermen (invoerbalk gepind onderaan, dialog over de app) waar een footer alleen ruimte
 *  inneemt — zeker op mobiel. Op de overige pagina's (normale documentflow) staat hij gewoon onderaan.
 *  Zonder deze regel dook de footer op achter de instellingen-dialog, want die verandert wél de URL. */
export function SiteFooter() {
  const pathname = usePathname();
  if (isAppShellPad(pathname)) return null;

  return (
    <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4 text-xs text-faint">
      <span className="font-medium text-muted">Belastingdienst</span> · Methode Wetsanalyse
      (Ausems, Bulles &amp; Lokin) · Juridisch Analyseschema · brongetrouw herleidbaar naar
      artikel, lid en bronreferentie.
    </footer>
  );
}
