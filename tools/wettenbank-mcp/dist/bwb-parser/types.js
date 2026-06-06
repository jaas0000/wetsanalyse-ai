/**
 * BWB-parser: TypeScript types voor RAW en NORMALIZED datamodellen.
 *
 * DATA MODEL CONTRACT (geldt voor alle nodes):
 *   id       — uniek, stabiel, deterministisch (bijv. "BWBR0024096:artikel:9:lid:1:al:0")
 *   type     — lowercase, snake_case (bijv. "circulaire_divisie", niet "circulaire.divisie")
 *   metadata — genormaliseerde attributen en kopgegevens (camelCase, geen lege velden)
 *   children — structurele child-nodes (altijd array, ook bij 0 kinderen)
 *   content  — ALLEEN bij mixed-content nodes (al, li, entry); anders null
 */
export {};
