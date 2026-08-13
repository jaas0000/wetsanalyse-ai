/** Paden die de app-shell gebruiken in plaats van de globale site-chrome (logobalk + navigatie +
 *  gecentreerde documentflow).
 *
 *  `/workbench` is de chat-app met een eigen sidebar. `/instellingen` hoort er ook bij, en wel om
 *  een specifieke reden: het instellingenvenster is een intercepting route die als dialog **over**
 *  de werkplek opent. Bij zo'n navigatie verandert de URL wél (naar /instellingen/…) terwijl de
 *  werkplek eronder blijft staan. Zou de chrome op `usePathname()` afgaan zonder deze uitzondering,
 *  dan dook de logobalk op boven de openstaande dialog en verloor de werkplek zijn volle hoogte. */
export function isAppShellPad(pathname: string): boolean {
  return pathname === "/workbench" || pathname.startsWith("/instellingen");
}
