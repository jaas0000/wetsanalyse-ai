// Bouw precies één URL-pad-segment uit een (mogelijk al ge-encode) waarde.
//
// Next.js (App Router) levert dynamische route-params URL-geëncodeerd aan. Zo'n param dan
// nóg eens met encodeURIComponent in een upstream-URL coderen verdubbelt gereserveerde
// tekens: een artikelnummer als 4:86 wordt in de slug `...-art4:86`, de ':' wordt door de
// browser/Next `%3A`, en een tweede encode maakt daar `%253A` van — waarop de upstream-lookup
// 404't ("Project niet gevonden"). Eerst decoderen en dan precies één keer encoderen maakt de
// bewerking idempotent: zowel een al-geëncode als een kale waarde levert één, correct
// geëncodeerd segment op.
export function pathSegment(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Geen geldige percent-encoding: behandel de waarde als reeds gedecodeerd.
  }
  return encodeURIComponent(decoded);
}

// Veilige href voor een bronreferentie. Het veld komt (indirect) uit de analyse-pipeline/LLM
// en mag dus niet blind in een href: een waarde als `javascript:…` zou klikbare
// scriptuitvoering opleveren (React escaped tekst, maar niet de href-scheme).
//   - jci-uri (`jci1.3:c:BWBR…`)  → deeplink op wetten.overheid.nl (repareert meteen het
//     anders niet-navigeerbare jci-linkje);
//   - al complete http(s)-URL     → alleen toegestaan als de host wetten.overheid.nl is (host-pinning,
//     net als wettenOverheidHref) — een vreemde host wordt platte tekst, geen phishing-link;
//   - alles anders (javascript:, data:, leeg) → undefined ⇒ render als platte tekst, geen <a>.
export function bronHref(ref?: string | null): string | undefined {
  if (!ref) return undefined;
  const trimmed = ref.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname === "wetten.overheid.nl" ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^jci/i.test(trimmed)) return `https://wetten.overheid.nl/${encodeURI(trimmed)}`;
  return undefined;
}

// Veilige href voor een verwijzing-target: altijd als pad ónder wetten.overheid.nl opgebouwd,
// en daarna gevalideerd, zodat een vreemd schema of een andere host nooit kan ontsnappen.
export function wettenOverheidHref(target?: string | null): string | undefined {
  if (!target) return undefined;
  const url = `https://wetten.overheid.nl/${encodeURI(target.trim())}`;
  try {
    return new URL(url).hostname === "wetten.overheid.nl" ? url : undefined;
  } catch {
    return undefined;
  }
}
