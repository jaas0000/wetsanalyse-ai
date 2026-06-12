/**
 * Minimale DOM-interfaces, gedeeld door parser en clients.
 *
 * @xmldom/xmldom heeft zijn eigen Element-type dat botst met het globale
 * lib.dom.d.ts Element. Deze interfaces beschrijven precies het gedeelte van
 * de DOM dat dit project gebruikt, zodat de clients niet op `any` hoeven te
 * leunen (strict blijft effectief) en er maar één definitie bestaat.
 * Casten gebeurt uitsluitend op de DOMParser-grens.
 */
export {};
