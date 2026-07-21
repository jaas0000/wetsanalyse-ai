"""
Annotatie-flow: de agent markeert JAS-elementen in een wetsartikel.

Een dedicated flow (geen QA-chat): haal het artikel op via de GraphPort, laat het LLM de JAS-elementen
voorstellen (gestructureerde JSON), en verifieer elk element **brongetrouw** — het fragment moet
letterlijk in de artikeltekst voorkomen. Niet-onderbouwde of ongeldig-geclassificeerde voorstellen
worden verworpen (nooit stil doorgelaten). Hergebruikt de bouwstenen van de QA-agent (LLMPort,
GraphPort, run_sync, observability); spiegelt het SSE-event-contract van `agent.py:answer_stream`.
"""
from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator, Iterator
from typing import Any

from .agent_common import run_sync
from .annotatie_prompt import annotatie_systeemprompt, annotatie_userprompt
from .config import Settings
from .graph import queries
from .jas_klassen import GELDIGE_JAS_KLASSEN
from .models import AnnotatieAlternatief, AnnotatieVoorstel
from .observability import get_tracer
from .ports import GraphPort, LLMPort

logger = logging.getLogger("graph_qa.annotatie")

_WS = re.compile(r"\s+")


def _normaliseer(s: str) -> str:
    """Collapse witruimte, zodat een fragment ondanks layout-verschillen matcht."""
    return _WS.sub(" ", s or "").strip()


def _balanced_objecten(text: str) -> Iterator[str]:
    """Yield elke gebalanceerde {…}-substring op élk niveau (string-/escape-bewust).

    Elementen zitten genest in de wrapper `{"elementen": [ {…}, {…} ]}`, dus we moeten ook geneste
    objecten opleveren. Een afgekapt (nooit-gesloten) object levert niets op — precies wat we willen.
    """
    stack: list[int] = []
    in_str = False
    escape = False
    for i, ch in enumerate(text):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            stack.append(i)
        elif ch == "}":
            if stack:
                yield text[stack.pop() : i + 1]


def _parse_elementen(text: str) -> list[dict[str, Any]]:
    """Haal de element-objecten uit de LLM-respons.

    Fast-path: de hele respons als één JSON-object met `elementen`. Faalt dat (proza eromheen,
    afgekapt op max_tokens, code-fences), dan **salvagen** we de losse gebalanceerde {…}-objecten die
    op een element lijken (met `klasse` én `tekst`) — zo overleeft een afgekapt of omlijst antwoord
    (het onvolledige laatste object valt weg, de complete blijven) i.p.v. dat álles wegvalt.
    """
    raw = (text or "").strip()
    kandidaat = raw
    if kandidaat.startswith("```"):
        kandidaat = kandidaat.strip("`")
        if kandidaat.lower().startswith("json"):
            kandidaat = kandidaat[4:]
    s, e = kandidaat.find("{"), kandidaat.rfind("}")
    if s != -1 and e > s:
        try:
            data = json.loads(kandidaat[s : e + 1])
            if isinstance(data, dict) and isinstance(data.get("elementen"), list):
                return [x for x in data["elementen"] if isinstance(x, dict)]
        except json.JSONDecodeError:
            pass
    gered: list[dict[str, Any]] = []
    for obj in _balanced_objecten(raw):
        try:
            d = json.loads(obj)
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict) and "klasse" in d and "tekst" in d:
            gered.append(d)
    return gered


def _verwerk(
    llm_text: str, corpus: str, bwb_id: str, artikel: str
) -> tuple[list[AnnotatieVoorstel], int]:
    """Parse de LLM-JSON, valideer klasse + brongetrouwheid, bereken span/vindplaats."""
    norm_corpus = _normaliseer(corpus)
    voorstellen: list[AnnotatieVoorstel] = []
    verworpen = 0
    rauw = _parse_elementen(llm_text)
    if not rauw and llm_text.strip():
        logger.warning("annotatie: geen element-objecten uit de respons gehaald")

    for e in rauw:
        klasse = str(e.get("klasse", "")).strip()
        fragment = str(e.get("tekst", "")).strip()
        norm_frag = _normaliseer(fragment)
        idx = norm_corpus.find(norm_frag) if norm_frag else -1
        # Verwerp ongeldige klasse of niet-onderbouwd fragment: nooit stil doorlaten.
        if klasse not in GELDIGE_JAS_KLASSEN or idx < 0:
            verworpen += 1
            continue
        lid = str(e.get("lid", "")).strip()
        alts = [
            AnnotatieAlternatief(klasse=str(a.get("klasse", "")).strip(), motivatie=str(a.get("motivatie", "")).strip())
            for a in e.get("alternatieven", [])
            if isinstance(a, dict) and str(a.get("klasse", "")).strip() in GELDIGE_JAS_KLASSEN
        ]
        vindplaats = f"{bwb_id} art. {artikel}" + (f" lid {lid}" if lid else "")
        voorstellen.append(
            AnnotatieVoorstel(
                klasse=klasse,
                tekst=fragment,
                lid=lid,
                toelichting=str(e.get("toelichting", "")).strip(),
                alternatieven=alts,
                span=[idx, idx + len(norm_frag)],
                grounded=True,
                vindplaats=vindplaats,
            )
        )
    return voorstellen, verworpen


async def annoteer_stream(
    bwb_id: str,
    artikel: str,
    lid: str | None = None,
    *,
    settings: Settings | None = None,
    llm: LLMPort | None = None,
    graph: GraphPort | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """
    Async generator die SSE-events yield:
      {"type": "status", "message": "..."}
      {"type": "element", "element": {...}}      # per grounded JAS-element
      {"type": "done", "aantal": int, "verworpen": int}
      {"type": "error", "message": "..."}
    """
    settings = settings or Settings.from_env()

    try:
        if graph is None:
            from .adapters.graphdb_graph import make_graph

            graph = make_graph(settings)
        if llm is None:
            from .adapters.anthropic_llm import AnthropicLLM

            llm = AnthropicLLM(settings)
        await run_sync(graph.initialize)
    except Exception as exc:
        logger.warning("MCP-verbinding mislukt", exc_info=True)
        yield {"type": "error", "message": f"MCP-verbinding mislukt: {exc}"}
        if graph is not None:
            graph.close()
        return

    tracer = get_tracer(__name__)
    try:
        with tracer.start_as_current_span("graph_qa.annoteer") as span:
            span.set_attribute("annotatie.bwb_id", bwb_id)
            span.set_attribute("annotatie.artikel", artikel)
            yield {"type": "status", "message": f"Artikel {artikel} ophalen..."}
            corpus = await run_sync(graph.sparql, queries.get_artikel(bwb_id, artikel))
            if not (corpus or "").strip():
                yield {"type": "error", "message": f"Geen tekst gevonden voor {bwb_id} artikel {artikel}."}
                return

            yield {"type": "status", "message": "Agent annoteert volgens het JAS..."}
            resp = await run_sync(
                lambda: llm.create(
                    model=settings.llm_model,
                    max_tokens=8192,
                    system=annotatie_systeemprompt(),
                    tools=[],
                    messages=[{"role": "user", "content": annotatie_userprompt(bwb_id, artikel, corpus)}],
                )
            )
            llm_text = "".join(b.text for b in resp.content if b.type == "text")
            voorstellen, verworpen = _verwerk(llm_text, corpus, bwb_id, artikel)

            for v in voorstellen:
                yield {"type": "element", "element": v.model_dump()}
            span.set_attribute("annotatie.elementen", len(voorstellen))
            span.set_attribute("annotatie.verworpen", verworpen)
            logger.info(
                "annotatie klaar",
                extra={"categorie": "functioneel", "annotatie_bwb_id": bwb_id, "annotatie_artikel": artikel,
                       "annotatie_elementen": len(voorstellen), "annotatie_verworpen": verworpen,
                       "stop_reason": getattr(resp, "stop_reason", None), "respons_lengte": len(llm_text)},
            )
            yield {"type": "done", "aantal": len(voorstellen), "verworpen": verworpen}
    except Exception as exc:
        logger.error("annotatie-fout", exc_info=True)
        yield {"type": "error", "message": f"Annotatie-fout: {exc}"}
    finally:
        graph.close()
