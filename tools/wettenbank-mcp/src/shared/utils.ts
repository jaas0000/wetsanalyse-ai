/**
 * Gedeelde hulpfuncties voor de wettenbank-mcp tools.
 */

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
