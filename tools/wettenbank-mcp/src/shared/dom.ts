/**
 * Minimale DOM-interfaces, gedeeld door parser en clients.
 *
 * @xmldom/xmldom heeft zijn eigen Element-type dat botst met het globale
 * lib.dom.d.ts Element. Deze interfaces beschrijven precies het gedeelte van
 * de DOM dat dit project gebruikt, zodat de clients niet op `any` hoeven te
 * leunen (strict blijft effectief) en er maar één definitie bestaat.
 * Casten gebeurt uitsluitend op de DOMParser-grens.
 */

export interface DomAttr {
  name: string;
  value: string;
}

export interface DomNode {
  nodeType: number;
  nodeValue: string | null;
  childNodes: DomNodeList;
}

export interface DomNodeList {
  length: number;
  item(index: number): DomNode;
}

/** Array-achtige collectie zoals getElementsByTagName die teruggeeft. */
export interface DomCollection<T> {
  length: number;
  item(index: number): T | null;
  [index: number]: T;
}

export interface DomElement extends DomNode {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  attributes: {
    length: number;
    item(index: number): DomAttr | null;
  };
  getElementsByTagName(name: string): DomCollection<DomElement>;
  getElementsByTagNameNS(namespaceURI: string, localName: string): DomCollection<DomElement>;
}

export interface DomDocument extends DomNode {
  documentElement: DomElement | null;
  getElementsByTagName(name: string): DomCollection<DomElement>;
  getElementsByTagNameNS(namespaceURI: string, localName: string): DomCollection<DomElement>;
}
