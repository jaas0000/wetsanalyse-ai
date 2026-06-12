/**
 * Gedeelde hulpfuncties voor de wettenbank-mcp tools.
 */

import type { ZodError } from "zod";

/**
 * Detecteert of tekst Markdown-opmaak bevat (tabellen, lijsten).
 * Gedeeld door wettenbank_artikel en wettenbank_zoekterm.
 */
export function detecteerFormaat(tekst: string): "plain" | "markdown" {
  if (/\|.*\|/.test(tekst)) return "markdown";   // tabel
  if (/^\d+\. /m.test(tekst)) return "markdown";  // genummerde lijst
  if (/^[a-z]\. /m.test(tekst)) return "markdown"; // lettertjes-lijst
  if (/^– /m.test(tekst)) return "markdown";       // streepjes-lijst
  return "plain";
}

/**
 * Vandaag als YYYY-MM-DD in Europe/Amsterdam. De server draait in UTC (Docker)
 * terwijl analisten in NL werken; rond middernacht zou de UTC-datum anders een
 * dag afwijken van wat de analist als "vandaag" bedoelt als peildatum.
 */
export function vandaag(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
  }).format(new Date());
}

/**
 * Formatteer álle Zod-issues mét veldpad tot één melding, zodat de client niet
 * per ronde één kale fout ("Required") terugkrijgt zonder te weten welk veld.
 */
export function formatteerZodFout(error: ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
