"""Promotie van een geaccordeerde act-2-analyse → JAS-annotatielaag in GraphDB.

**Eén** geauthenticeerd, idempotent schrijfpad (Fase 2 / WS4). Per analyse één **named graph**
(`<JAS_GRAPH_PREFIX><slug>`): promoveren = die graaf volledig **vervangen** (DROP SILENT + INSERT
DATA), dus opnieuw promoveren is idempotent — geen dubbele of verweesde annotaties. De JAS-annotaties
hangen aan de bestaande bepaling-IRI's van de kennisgraaf (`graph_queries.artikel_iri`/`lid_iri`), plus
literals (`jas:bwbId`/`jas:artikel`/`jas:lid`) zodat ook decimale bepaling-nummers (9.1) herleidbaar zijn.

Least privilege: een **apart schrijf-token** (`GRAPHDB_WRITE_TOKEN`) en een SPARQL-UPDATE-endpoint
(`GRAPHDB_UPDATE_URL`); leeg = promotie uit (fail-closed). Géén begrippen/SKOS (buiten scope).

Het schrijven loopt achter een `GraphWritePort` zodat tests een `FakeGraphWrite` injecteren. De
ontologie staat in `docs/wetsanalyse-workbench/jas-annotatie-ontologie.md`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from . import graph_queries as q
from .config import Settings

logger = logging.getLogger("wetsanalyse.graph_write")

JAS_NS = "https://ipalm.nl/ns/jas#"
_ART_RE = q._ART_RE  # artikel/lid-IRI-patroon (kaal nummer + letters); decimaal (9.1) matcht bewust niet


class GraphWriteError(RuntimeError):
    """Promotie mislukte of is niet geconfigureerd — nooit stil doorgaan."""


@runtime_checkable
class GraphWritePort(Protocol):
    async def replace_graph(self, graph_iri: str, triples: str) -> None:
        """Vervang de named graph `graph_iri` volledig door `triples` (SPARQL-TriplesTemplate).
        Idempotent: DROP SILENT GRAPH + INSERT DATA in één update."""
        ...


# --- IRI/literal-helpers -------------------------------------------------------

def graaf_iri(prefix: str, slug: str) -> str:
    return f"{prefix}{slug}"


def _annotatie_iri(prefix: str, slug: str, bron_id: str, mid: str) -> str:
    return f"{prefix}{slug}/{bron_id}/{mid}"


def _lit(text) -> str:
    """Veilige SPARQL-stringliteral (quotes/backslash/newlines geëscaped)."""
    s = str(text or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", " ")
    return f'"{s}"'


def _bepaling_iri(bwb_id: str, artikel: str, lid) -> str | None:
    """De bestaande bepaling-IRI (lid- of artikel-niveau) als het nummer het IRI-patroon volgt;
    anders None (dan valt de herleidbaarheid op de bwbId/artikel-literals)."""
    try:
        art = str(artikel or "").strip()
        if not _ART_RE.match(art):
            return None
        lidnr = str(lid or "").strip()
        return q.lid_iri(bwb_id, art, lidnr) if lidnr and lidnr.isdigit() else q.artikel_iri(bwb_id, art)
    except ValueError:
        return None


# --- triple-bouw ---------------------------------------------------------------

def bouw_jas_triples(rapport: dict, slug: str, *, prefix: str, gepromoveerd_op: str | None = None) -> tuple[str, dict]:
    """Bouw de JAS-annotatie-triples (SPARQL-TriplesTemplate-tekst) uit een act-2-rapport.

    Geeft (triples_tekst, samenvatting) terug; samenvatting = {aantal, klassen{klasse:aantal}}.
    Elke markering wordt één `jas:Annotatie` met klasse/formulering/vindplaats + herleidbaarheid
    naar de bepaling (IRI en/of bwbId+artikel+lid) en naar de bron-analyse (`jas:uitAnalyse`).
    """
    ts = gepromoveerd_op or datetime.now(timezone.utc).isoformat()
    regels: list[str] = [
        f"<{graaf_iri(prefix, slug)}> a <{JAS_NS}AnnotatieLaag> ; "
        f"<{JAS_NS}uitAnalyse> {_lit(slug)} ; <{JAS_NS}gepromoveerdOp> {_lit(ts)} .",
    ]
    aantal = 0
    klassen: dict[str, int] = {}
    for bron in rapport.get("bronnen") or []:
        bron_id = str(bron.get("bron_id") or "")
        bwb = str(bron.get("bwbId") or "")
        artikel = str(bron.get("artikel") or "")
        for m in bron.get("markeringen") or []:
            mid = str(m.get("id") or "")
            klasse = str(m.get("klasse") or "")
            if not (mid and klasse):
                continue
            ann = _annotatie_iri(prefix, slug, bron_id, mid)
            props = [
                f"a <{JAS_NS}Annotatie>",
                f"<{JAS_NS}klasse> {_lit(klasse)}",
                f"<{JAS_NS}formulering> {_lit(m.get('formulering'))}",
                f"<{JAS_NS}vindplaats> {_lit(m.get('vindplaats'))}",
                f"<{JAS_NS}markeringId> {_lit(mid)}",
                f"<{JAS_NS}uitAnalyse> {_lit(slug)}",
                f"<{JAS_NS}bwbId> {_lit(bwb)}",
                f"<{JAS_NS}artikel> {_lit(artikel)}",
            ]
            if m.get("toelichting"):
                props.append(f"<{JAS_NS}toelichting> {_lit(m.get('toelichting'))}")
            if m.get("twijfel"):
                props.append(f"<{JAS_NS}twijfel> {_lit(m.get('twijfel'))}")
            lid = m.get("lid") or bron.get("lid")
            if lid:
                props.append(f"<{JAS_NS}lid> {_lit(lid)}")
            bep = _bepaling_iri(bwb, artikel, lid)
            if bep:
                props.append(f"<{JAS_NS}overBepaling> <{bep}>")
            regels.append(f"<{ann}> " + " ; ".join(props) + " .")
            aantal += 1
            klassen[klasse] = klassen.get(klasse, 0) + 1
    return "\n".join(regels), {"aantal": aantal, "klassen": klassen, "gepromoveerd_op": ts}


async def promoveer(port: GraphWritePort, rapport: dict, slug: str, *, prefix: str) -> dict:
    """Promoveer een act-2-rapport naar de JAS-annotatielaag. Idempotent (named-graph-replace)."""
    triples, samenvatting = bouw_jas_triples(rapport, slug, prefix=prefix)
    giri = graaf_iri(prefix, slug)
    await port.replace_graph(giri, triples)
    samenvatting["graph_iri"] = giri
    # Audit: gestructureerde logregel (naast de graaf-provenance jas:gepromoveerdOp/uitAnalyse).
    logger.info(
        "JAS-promotie",
        extra={"categorie": "graph-promotie", "slug": slug, "graph_iri": giri,
               "aantal": samenvatting["aantal"], "klassen": samenvatting["klassen"]},
    )
    return samenvatting


# --- echte schrijfclient (SPARQL UPDATE over HTTP) -----------------------------

class GraphDBWriteClient:
    """Schrijft via SPARQL UPDATE naar de GraphDB-REST (`…/statements`) met het aparte schrijf-token.
    Fail-closed: zonder token/url een `GraphWriteError` (promotie is bewust opt-in)."""

    def __init__(self, settings: Settings) -> None:
        self.url = settings.graphdb_update_url
        self.token = settings.graphdb_write_token
        self.timeout = settings.graphdb_timeout_s

    async def replace_graph(self, graph_iri: str, triples: str) -> None:
        if not self.url or not self.token:
            raise GraphWriteError(
                "Promotie niet geconfigureerd: zet GRAPHDB_WRITE_TOKEN en GRAPHDB_UPDATE_URL."
            )
        update = f"DROP SILENT GRAPH <{graph_iri}> ;\nINSERT DATA {{ GRAPH <{graph_iri}> {{\n{triples}\n}} }}"
        import httpx
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/sparql-update"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(self.url, content=update.encode("utf-8"), headers=headers)
        except Exception as e:  # noqa: BLE001
            raise GraphWriteError(f"GraphDB-UPDATE mislukte: {e}") from e
        if resp.status_code >= 400:
            raise GraphWriteError(f"GraphDB-UPDATE HTTP {resp.status_code}: {resp.text[:200]}")
