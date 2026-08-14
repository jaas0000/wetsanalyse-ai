// Waar een popover die aan een tekstselectie hangt terechtkomt.
//
// Pure functie, geen DOM: vitest draait node-env, en dit is precies het soort rekenwerk dat je niet
// met de hand wilt narekenen in een browser. Het component meet de maten en geeft ze hier door.

export interface Plaatsing {
  left: number;
  top: number;
  /** Staat de popover bóven de selectie? Alleen voor de weergave (animatierichting). */
  boven: boolean;
}

/** Plaats een popover van `breedte` × `hoogte` bij een selectie, binnen het scherm.
 *
 *  Onder de selectie als het past, anders erboven. Past het aan geen van beide kanten, dan wint de
 *  bovenkant van het scherm: dan is de popover wél te bedienen (de klassen staan bovenin) in plaats
 *  van half onder de vouw. Horizontaal gecentreerd op de selectie, met een marge langs de randen.
 *
 *  De verticale klem ontbrak: op een telefoonscherm viel de klasse-lijst onder de rand, en
 *  meescrollen kan niet omdat het element `position: fixed` is.
 */
export function plaatsPopover(
  selectie: { midden: number; boven: number; onder: number },
  popover: { breedte: number; hoogte: number },
  scherm: { breedte: number; hoogte: number },
  marge = 8,
): Plaatsing {
  const left = Math.max(
    marge,
    Math.min(selectie.midden - popover.breedte / 2, scherm.breedte - popover.breedte - marge),
  );

  const onderTop = selectie.onder + marge;
  if (onderTop + popover.hoogte + marge <= scherm.hoogte) return { left, top: onderTop, boven: false };

  const bovenTop = selectie.boven - popover.hoogte - marge;
  if (bovenTop >= marge) return { left, top: bovenTop, boven: true };

  // Past nergens heel: tegen de bovenrand, zodat de bovenste knoppen bereikbaar blijven.
  return { left, top: marge, boven: false };
}
