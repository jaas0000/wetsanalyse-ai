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
