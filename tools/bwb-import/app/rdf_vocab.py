"""Custom RDF-vocabulaire + IRI-schema voor het BWB-model.

Modelleert het BWB-model in RDF: elke entiteit wordt een klasse, elke relatie
een predicaat. Eén ``Vocab`` bundelt de twee configureerbare
namespaces (resources vs. ontologie) en levert deterministische IRI's.

De artikel-/divisie-IRI wordt afgeleid van de ``ref_key`` (JuriConnect-sleutel),
zodat een ``verwijstNaar`` naar een nog niet geïmporteerde wet naar exact
dezelfde IRI wijst — de doel-IRI krijgt vanzelf inhoud zodra die wet later wordt
geïmporteerd (RDF open-world; geen stub-nodes nodig).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import quote

from rdflib import XSD, Literal, Namespace, URIRef

DEFAULT_BASE_IRI = "https://ipalm.nl/bwb/"
DEFAULT_ONTOLOGY_IRI = "https://ipalm.nl/ns/bwb#"

# Canonieke publicatie-omgeving van het BWB; doel van ``owl:sameAs``-links.
WETTEN_BASE = "https://wetten.overheid.nl/"

_BWB_ID = re.compile(r"BWB[RV]\d+")

# Node-prop-sleutels die niet als literal worden weggeschreven (zitten in de IRI
# of zijn intern).
_SKIP_PROPS = {"id", "stub", "iri_soort", "iri_sleutel"}

# Datatype per prop-sleutel; alleen toegepast als de waarde het formaat ook
# echt heeft (defensief: bron-attributen kunnen afwijken van de XSD).
_PROP_DATATYPES: dict[str, URIRef] = {
    "geldig_vanaf": XSD.date,
    "geldig_tot": XSD.date,
    "inwerking": XSD.date,
    "terugwerkend_tot": XSD.date,
    "ondertekeningsdatum": XSD.date,
    "uitgiftedatum": XSD.date,
    "publicatiejaar": XSD.gYear,
    "publicatienr": XSD.integer,
}

# Props met Nederlandstalige tekst -> taaltag ``@nl``.
_PROP_TAAL_NL = {
    "tekst",
    "titel",
    "opschrift",
    "citeertitel",
    "considerans",
    "aanhef",
    "definieert_begrip",
    "anker_tekst",
    "voetnoot",
}

_ISO_DATUM = re.compile(r"\d{4}-\d{2}-\d{2}")
_JAAR = re.compile(r"\d{4}")


def _camel(snake: str) -> str:
    """``heeft_artikel`` / ``HEEFT_ARTIKEL`` / ``geldig_vanaf`` -> camelCase."""
    delen = snake.lower().split("_")
    return delen[0] + "".join(p.capitalize() for p in delen[1:])


@dataclass(frozen=True)
class Vocab:
    """IRI-fabriek + termen voor één configuratie van namespaces."""

    base: str = DEFAULT_BASE_IRI
    ontology: str = DEFAULT_ONTOLOGY_IRI

    @property
    def ns(self) -> Namespace:
        return Namespace(self.ontology)

    # ------------------------------------------------------------- resource-IRI's
    def wet(self, bwb_id: str) -> URIRef:
        return URIRef(f"{self.base}{quote(bwb_id, safe='')}")

    def graph(self, bwb_id: str) -> URIRef:
        """Named-graph-IRI voor één wet (idempotente re-import per graaf)."""
        return URIRef(f"{self.base}graph/{quote(bwb_id, safe='')}")

    def ontology_graph(self) -> URIRef:
        """Named-graph-IRI voor de ontologie (T-Box); PUT = idempotent."""
        return URIRef(f"{self.base}graph/ontologie")

    @property
    def ontology_resource(self) -> URIRef:
        """IRI van de ontologie zelf (namespace zonder afsluitende ``#``/``/``)."""
        return URIRef(self.ontology.rstrip("#/"))

    def canonieke_url(self, ref_key: str) -> URIRef | None:
        """Canonieke wetten.overheid.nl-URL voor een ref_key (``owl:sameAs``-doel).

        ``{bwb}``                  -> ``{WETTEN_BASE}{bwb}``
        ``{bwb}#artikel={nr}[…]``  -> ``{WETTEN_BASE}jci1.3:c:{bwb}&artikel={nr}[…]``
        ``{bwb}#id={id}``          -> ``None`` (geen jci-adresseerbare vorm).
        """
        bwb, _, rest = ref_key.partition("#")
        if not _BWB_ID.fullmatch(bwb):
            return None
        if not rest:
            return URIRef(f"{WETTEN_BASE}{bwb}")
        delen: list[str] = []
        for segment in rest.split("#"):
            sleutel, _, waarde = segment.partition("=")
            if sleutel == "id" or not waarde:
                return None
            delen.append(f"&{sleutel}={quote(waarde, safe=':.')}")
        return URIRef(f"{WETTEN_BASE}jci1.3:c:{bwb}{''.join(delen)}")

    def by_id(self, bwb_id: str, xml_id: str) -> URIRef:
        """IRI voor een niet-citeerbare node (hoofdstuk/afdeling/lid/onderdeel …)."""
        return URIRef(f"{self.base}{quote(bwb_id, safe='')}/id/{quote(xml_id, safe='')}")

    def by_ref_key(self, ref_key: str) -> URIRef:
        """IRI voor een citeerbare node/verwijs-doel, afgeleid van de ref_key.

        ``{bwb}``                         -> ``BASE{bwb}`` (de wet zelf)
        ``{bwb}#artikel={nr}``            -> ``BASE{bwb}/artikel/{nr}``
        ``{bwb}#hoofdstuk={nr}`` (etc.)   -> ``BASE{bwb}/hoofdstuk/{nr}``
        ``{bwb}#artikel=2#lid=1#o=a``     -> ``BASE{bwb}/artikel/2/lid/1/o/a``
        ``{bwb}#id={id}``                 -> ``BASE{bwb}/id/{id}``
        (val terug op een gehashte IRI als het formaat onbekend is).
        """
        bwb, _, rest = ref_key.partition("#")
        if bwb and not rest:
            return self.wet(bwb)
        segmenten: list[str] = []
        for segment in rest.split("#"):
            sleutel, _, waarde = segment.partition("=")
            if not bwb or not sleutel or not waarde:
                digest = hashlib.sha1(ref_key.encode("utf-8")).hexdigest()[:16]
                return URIRef(f"{self.base}ref/{digest}")
            segmenten.append(f"{quote(sleutel, safe='')}/{quote(waarde, safe='')}")
        return URIRef(f"{self.base}{quote(bwb, safe='')}/{'/'.join(segmenten)}")

    def begrip(self, label: str) -> URIRef:
        """IRI voor een thesaurusterm (rechtsgebied/overheidsdomein) op slug."""
        slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
        return URIRef(f"{self.base}begrip/{quote(slug, safe='')}")

    def entiteit(self, soort: str, sleutel: str) -> URIRef:
        """Deterministische, wet-overstijgende IRI voor een gedeelde entiteit
        (bv. ``ondertekenaar``/``organisatie``) op slug.

        Zo valt dezelfde persoon/organisatie over wetten heen samen tot één node
        (open-world; elke wet-graaf her-assert de node, net als thesaurustermen).
        """
        slug = re.sub(r"[^a-z0-9]+", "-", sleutel.lower()).strip("-")
        return URIRef(f"{self.base}{quote(soort, safe='')}/{quote(slug, safe='')}")

    def verwijzing(self, bron: URIRef, doel: URIRef, soort: str) -> URIRef:
        """Deterministische IRI voor de tussenresource van één verwijzing."""
        sleutel = f"{bron}|{doel}|{soort}".encode()
        digest = hashlib.sha1(sleutel).hexdigest()[:16]
        return URIRef(f"{self.base}verwijzing/{digest}")

    # ---------------------------------------------------------------------- termen
    def klasse(self, entiteit: str) -> URIRef:
        return self.ns[entiteit]

    def predicaat_rel(self, rel_type: str) -> URIRef:
        """``HEEFT_ARTIKEL`` -> ``bwb:heeftArtikel``, ``VOLGT_OP`` -> ``bwb:volgtOp``."""
        return self.ns[_camel(rel_type)]

    def predicaat_prop(self, prop_key: str) -> URIRef:
        """``bwb_id`` -> ``bwb:bwbId``, ``geldig_vanaf`` -> ``bwb:geldigVanaf``."""
        return self.ns[_camel(prop_key)]

    @staticmethod
    def skip_prop(prop_key: str) -> bool:
        return prop_key in _SKIP_PROPS

    # -------------------------------------------------------------------- literals
    @staticmethod
    def literal(prop_key: str, value) -> Literal:
        """Getypeerde literal voor een prop: ``xsd:date``/``gYear``/``integer``
        waar dat kan, ``@nl`` op Nederlandstalige tekst, anders platte string."""
        tekst = str(value)
        datatype = _PROP_DATATYPES.get(prop_key)
        if datatype == XSD.date and _ISO_DATUM.fullmatch(tekst):
            return Literal(tekst, datatype=XSD.date)
        if datatype == XSD.gYear and _JAAR.fullmatch(tekst):
            return Literal(tekst, datatype=XSD.gYear)
        if datatype == XSD.integer and tekst.isdigit():
            return Literal(tekst, datatype=XSD.integer)
        if prop_key in _PROP_TAAL_NL:
            return Literal(tekst, lang="nl")
        return Literal(tekst)
