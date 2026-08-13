"""
LangGraph-orkestrator: plan → retrieve → reason → verify → finalize.

LangGraph levert het toestandsgraaf-substraat (nodes, conditionele edges, streaming,
checkpointing); de domeinlogica blijft die van Fase 1/2 — de nodes roepen de bestaande
LLMPort/GraphPort, de typed tool-registry, provenance en grounding aan. Geen
langchain-chatmodel: Azure Foundry blijft via AnthropicLLM.

Geheugen zit in de state en wordt door de checkpointer (thread_id = conversation_id)
gepersisteerd: `messages` (episodisch, append-reducer) en `entities_seen` (de "in
beeld"-set geraadpleegde bepalingen, semantische/entiteit-tier). De wrapper compileert
`build_graph()` met de gekozen checkpointer.

Streaming loopt via LangGraph's custom-stream (get_stream_writer); answer_stream
consumeert het en houdt het SSE-contract gelijk. Nodes zijn synchroon (threadpool),
zodat de blocking LLM-/MCP-calls de event-loop niet blokkeren.
"""
from __future__ import annotations

import logging
import operator
import re
from typing import Annotated, Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from .agent_common import truncate
from .annotatie import _verwerk, _verwerk_critic
from .annotatie_prompt import (
    annotatie_systeemprompt,
    annotatie_userprompt,
    critic_systeemprompt,
    critic_userprompt,
)
from .config import Settings
from .graph.results import parse_select
from .grounding import check_grounding, curate_sources
from .ports import GraphPort, LLMPort
from .prompts import SYSTEM_PROMPT
from .provenance import collect_sources
from .specialists import get as get_specialist
from .supervisor import SUPERVISOR_SYSTEM, parse_supervisor
from .tools import anthropic_schemas, dispatch

logger = logging.getLogger("graph_qa.orchestrator")


def _doel_uit_json(text: str) -> dict[str, str]:
    """Haal het doel ({bwbId,artikel,lid,nummer}) uit de JSON van de ophaal-agent — plat of onder een
    `doel`-sleutel."""
    import json

    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e > s:
        try:
            data = json.loads(text[s : e + 1])
            if isinstance(data, dict):
                d = data.get("doel") if isinstance(data.get("doel"), dict) else data
                return {k: str(d.get(k, "")).strip() for k in ("bwbId", "artikel", "lid", "nummer", "citeertitel")}
        except json.JSONDecodeError:
            pass
    return {"bwbId": "", "artikel": "", "lid": "", "nummer": "", "citeertitel": ""}


def _doel_uit_toolcalls(messages: list[dict[str, Any]]) -> dict[str, str]:
    """Gezaghebbend doel = de LAATSTE fetch-tool-call (get_lid/get_artikel/get_bepaling) die de agent
    deed — wat hij écht ophaalde. get_bepaling levert een `nummer` (bv. '9.1' voor een divisie); dat
    zetten we óók als `artikel`, zodat de weergave het aankan. Leeg als er geen fetch-call was."""
    doel = {"bwbId": "", "artikel": "", "lid": "", "nummer": ""}
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for blok in content:
            if not (isinstance(blok, dict) and blok.get("type") == "tool_use"):
                continue
            naam = blok.get("name")
            inp = blok.get("input") or {}
            if naam in ("get_lid", "get_artikel"):
                doel = {
                    "bwbId": str(inp.get("bwb_id", "")).strip(),
                    "artikel": str(inp.get("artikel", "")).strip(),
                    "lid": str(inp.get("lid", "")).strip(),
                    "nummer": "",
                }
            elif naam == "get_bepaling":
                nummer = str(inp.get("nummer", "")).strip()
                doel = {"bwbId": str(inp.get("bwb_id", "")).strip(), "artikel": nummer, "lid": "", "nummer": nummer}
    return doel


def _bepaal_doel(state: State) -> dict[str, str]:
    """Combineer: neem de tool-call als bron (gezaghebbend) en vul lege velden aan uit de JSON."""
    uit_tool = _doel_uit_toolcalls(state.get("messages", []))
    uit_json = _doel_uit_json(state.get("answer", ""))
    return {k: uit_tool.get(k, "") or uit_json.get(k, "") for k in ("bwbId", "artikel", "lid", "nummer", "citeertitel")}


def _corpus_uit_trace(source_trace: list[tuple[str, str]]) -> str:
    """Reconstrueer de opgehaalde artikeltekst uit de get_lid/get_artikel-resultaten in de trace,
    zodat de brongetrouwheid-check dezelfde tekst gebruikt die de agent zag."""
    delen: list[str] = []
    for naam, resultaat in source_trace:
        if naam not in ("get_lid", "get_artikel", "get_bepaling"):
            continue
        for r in parse_select(resultaat):
            tekst = (r.get("lidtekst") or r.get("tekst") or "").strip()
            if tekst:
                delen.append(tekst)
    return "\n\n".join(delen)

_DECOMPOSE_SYSTEM = (
    "Je splitst een juridische vraag over de kennisgraaf op in de deelvragen die je apart moet "
    "beantwoorden om de hele vraag te dekken. Geef ELKE deelvraag op een eigen regel, genummerd "
    "(1., 2., …), in logische volgorde (een deelvraag mag voortbouwen op een eerdere). Splits ALLEEN "
    "als de vraag echt meerdere losse onderdelen heeft; een enkelvoudige vraag geef je als één regel "
    "terug (de vraag zelf). Verzin geen deelvragen die niet in de oorspronkelijke vraag besloten "
    "liggen. Geen inleiding of uitleg — alleen de genummerde regels."
)

_SYNTHESE_SYSTEM = (
    "Je stelt één samenhangend eindantwoord samen uit de per-deelvraag verzamelde bevindingen. "
    "Steun UITSLUITEND op die bevindingen — voeg geen nieuwe feiten toe en verzin geen vindplaatsen. "
    "Behoud de vindplaatsen (regeling/artikel/lid) letterlijk zoals ze in de bevindingen staan. "
    "Antwoord bondig en goed gestructureerd; adresseer elk onderdeel van de oorspronkelijke vraag."
)


def _parse_final(final: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Splits een Anthropic-response in (tool_uses, text_parts)."""
    tool_uses: list[dict[str, Any]] = []
    text_parts: list[str] = []
    for block in final.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_uses.append({"id": block.id, "name": block.name, "input": block.input})
    return tool_uses, text_parts


def _msg_lengte(m: dict[str, Any]) -> int:
    c = m.get("content")
    if isinstance(c, str):
        return len(c)
    if isinstance(c, list):
        return sum(len(str(b)) for b in c)
    return 0


def _is_tool_result_user(m: dict[str, Any]) -> bool:
    """Een user-message dat (alleen) tool_result-blokken draagt — orphan als z'n tool_use is weggevallen."""
    c = m.get("content")
    return (
        m.get("role") == "user"
        and isinstance(c, list)
        and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c)
    )


def _is_plain_user(m: dict[str, Any]) -> bool:
    """Een 'platte' user-beurt (de vraag/correctie) — géén tool_result-drager. Zo'n bericht is een
    geldig venster-begin: alles erna is een compleet assistant→tool_result-verloop."""
    return m.get("role") == "user" and not _is_tool_result_user(m)


def _trim_messages(messages: list[dict[str, Any]], max_chars: int) -> list[dict[str, Any]]:
    """Beperk de historie die naar de LLM gaat tot een char-budget, met behoud van de
    tool_use/tool_result-integriteit (Anthropic weigert een orphan tool_result).

    Neem het achterste venster binnen budget en breid het begin zo nodig terug uit tot een platte
    user-beurt, zodat elk tool_result zijn tool_use behoudt (Anthropic weigert een orphan). Omdat
    messages[0] altijd een platte user-vraag is, termineert dat en is het resultaat nooit leeg;
    correctheid gaat daarbij boven het strikte char-budget. `max_chars<=0` → ongewijzigd.
    """
    if max_chars <= 0 or not messages:
        return messages
    total = 0
    start = 0
    for i in range(len(messages) - 1, -1, -1):
        total += _msg_lengte(messages[i])
        start = i
        if total >= max_chars:
            break
    # Loop terug over losgeknipte assistant/tool_result-berichten tot een geldig venster-begin
    # (een platte user-beurt), zodat er geen orphan tool_result vooraan blijft staan.
    while start > 0 and not _is_plain_user(messages[start]):
        start -= 1
    return messages[start:]


def _schoon_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip lege tekstblokken (Anthropic weigert {"type":"text","text":""} — Claude stuurt die soms
    mee náást een tool_use; via het gespreksgeheugen komen ze terug). Berichten waarvan de content
    daardoor leeg wordt, slaan we over; tool_use/tool_result en string-content blijven ongemoeid."""
    schoon: list[dict[str, Any]] = []
    for m in messages:
        c = m.get("content")
        if isinstance(c, list):
            nieuw = [
                b
                for b in c
                if not (isinstance(b, dict) and b.get("type") == "text" and not str(b.get("text", "")).strip())
            ]
            if nieuw:
                schoon.append({**m, "content": nieuw})
        else:
            schoon.append(m)
    return schoon


class State(TypedDict, total=False):
    question: str
    messages: Annotated[list[dict[str, Any]], operator.add]      # episodisch, gepersisteerd
    entities_seen: Annotated[list[str], operator.add]            # semantisch/entiteit-tier
    specialist: str
    plan: str
    worker_plan: list[str]   # geordende worker-keten (specialist-namen) die de supervisor koos
    worker_idx: int          # index van de huidige worker in worker_plan
    source_trace: list[tuple[str, str]]
    answer: str
    grounded: bool
    cited: int
    unsupported: list[str]
    sources: list[dict[str, Any]]
    pending_tools: list[dict[str, Any]]
    turns: int
    corrected: bool
    # Decompositie (multi-hop): deelvragen + per-deelvraag bevindingen (last-value-wins;
    # solve_node zet ze in één keer). De per-deelvraag agent⇄tools-loop draait lokaal in solve_node.
    sub_questions: list[str]
    sub_findings: list[dict[str, str]]
    # Annotatie: de gegronde voorstellen (als dicts) die annoteer_node maakt; critic_node scoort ze
    # met een aandacht-niveau en emit ze dán pas als `element`-events.
    #
    # Alle annotatie-velden zijn last-value-wins (géén operator.add-reducer): elke node levert de
    # volledige lijst. Met een append-reducer zou de Critic-feedback over rondes heen stapelen en
    # zou een herziening zijn eigen vorige oordeel als actueel aanzien.
    voorstellen: list[dict[str, Any]]
    verworpen_fragmenten: list[dict[str, Any]]   # niet-gegronde citaten, als feedback voor een herziening
    critic_feedback: list[dict[str, Any]]        # [{id, aandacht, motivatie, actie, voorstel_*}]
    critic_ontbrekend: list[dict[str, Any]]
    critic_gefaald: bool


def build_graph(settings: Settings, llm: LLMPort, graph: GraphPort) -> StateGraph:
    """Bouw de (ongecompileerde) toestandsgraaf; de wrapper compileert 'm met een checkpointer."""
    model = settings.llm_model

    def _memory_context(state: State) -> str:
        if not settings.enable_memory_context:
            return ""
        seen = list(dict.fromkeys(state.get("entities_seen") or []))  # dedup, volgorde behouden
        if not seen:
            return ""
        lijst = "\n".join(f"- {u}" for u in seen[-12:])
        return (
            "\n\nGESPREKSCONTEXT — eerder in dit gesprek geraadpleegde bepalingen (alléén als "
            "aanknopingspunt voor verwijzingen als 'dat artikel'; verifieer elk feit opnieuw via "
            f"de tools):\n{lijst}"
        )

    def supervisor_node(state: State) -> dict[str, Any]:
        """Bepaalt de worker-keten (antwoord/annotatie) voor deze vraag; zet de eerste worker actief."""
        writer = get_stream_writer()
        resp = llm.create(
            model=model,
            max_tokens=300,
            system=SUPERVISOR_SYSTEM + _memory_context(state),
            tools=[],
            messages=[{"role": "user", "content": state["question"]}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        worker_plan, plan = parse_supervisor(text)
        eerste = worker_plan[0]
        writer({"type": "status", "message": f"Specialist: {eerste} — {plan[:80]}"})
        return {"specialist": eerste, "plan": plan, "worker_plan": worker_plan, "worker_idx": 0}

    def _entry_node(state: State) -> str:
        """Ingang voor de huidige worker: de annotatie-worker draait altijd de agent⇄tools-lus; een
        antwoord-worker gaat in decompositie-modus langs decompose, anders ook langs de agent-lus."""
        if state.get("specialist") == "annotatie":
            return "agent"
        return "decompose" if settings.enable_decomposition else "agent"

    def advance_node(state: State) -> dict[str, Any]:
        """Ga naar de volgende worker in de keten; reset de per-worker werkvelden."""
        idx = state.get("worker_idx", 0) + 1
        plan = state.get("worker_plan") or []
        upd: dict[str, Any] = {"worker_idx": idx}
        if idx < len(plan):
            upd.update({"specialist": plan[idx], "turns": 0, "corrected": False, "answer": ""})
        return upd

    def route_after_advance(state: State) -> str:
        plan = state.get("worker_plan") or []
        if state.get("worker_idx", 0) < len(plan):
            return _entry_node(state)
        return "einde"

    def agent_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        # De annotatie-route draait de agent⇄tools-lus als OPHAAL-agent (retrieval-specialist): hij
        # vindt de exacte bepaling. De JAS-annotatie gebeurt daarna in annoteer_node (pure LLM-call).
        spec_naam = "retrieval" if state.get("specialist") == "annotatie" else state.get("specialist")
        spec = get_specialist(spec_naam)
        system = SYSTEM_PROMPT
        if spec.system:
            system = f"{system}\n\n{spec.system}"
        if state.get("plan"):
            system = f"{system}\n\nAANPAK (door jou gepland):\n{state['plan']}"
        system += _memory_context(state)

        # De annotatie-worker produceert JSON, geen leesbaar antwoord — díe narratie tonen we niet
        # (annoteer_node emit straks een korte samenvatting). De narratie van een gewone worker is de
        # "denkproces"-stroom (reason), niet het antwoord: die scheiden we van het eindantwoord (token).
        stream_naar_denk = state.get("specialist") != "annotatie"
        with llm.stream(
            model=model,
            max_tokens=4096,
            system=system,
            tools=anthropic_schemas(only=spec.tools),
            # Historie begrenzen (tegen onbegrensde promptgroei in een lange sessie); state blijft heel.
            messages=_trim_messages(_schoon_messages(state["messages"]), settings.max_history_chars),
        ) as stream:
            # Beurt-narratie stroomt per beurt binnen als `reason` (het denkproces). Op een beurt-grens
            # ontbreekt anders een scheiding, zodat "…tegelijkertijd." + "De thesaurus…" aan elkaar
            # plakt. Emit één alinea-scheiding vóór de éérste tekst van een vervolgbeurt (turns>0).
            # Lazy, zodat een tool-only beurt (geen tekst) geen loshangende of dubbele witregel geeft.
            first_delta = True
            for delta in stream.text_deltas:
                if stream_naar_denk:
                    if first_delta and state.get("turns", 0) > 0:
                        writer({"type": "reason", "content": "\n\n"})
                    writer({"type": "reason", "content": delta})
                first_delta = False
            final = stream.final_message()

        tool_uses, text_parts = _parse_final(final)

        # max_turns-vangnet: op de laatste toegestane beurt geen openstaande tool_use persisteren.
        # Anders belandt er een assistant(tool_use) zónder tool_result in de checkpointer (orphan →
        # de volgende beurt in dezelfde conversatie crasht op Anthropic 400) én blijft het antwoord
        # leeg. Laat de tools dan vallen en lever een net eind-antwoord (desnoods een korte melding).
        if tool_uses and state.get("turns", 0) + 1 >= settings.max_turns:
            tool_uses = []
            if not any(p and p.strip() for p in text_parts):
                text_parts = [
                    "Ik kon deze vraag niet binnen de beurtlimiet afronden; stel 'm eventueel gerichter."
                ]

        assistant_content: list[dict[str, Any]] = [{"type": "text", "text": p} for p in text_parts if p and p.strip()]
        assistant_content += [
            {"type": "tool_use", "id": t["id"], "name": t["name"], "input": t["input"]}
            for t in tool_uses
        ]

        upd: dict[str, Any] = {
            "messages": [{"role": "assistant", "content": assistant_content}],  # delta (append-reducer)
            "pending_tools": tool_uses,
            "turns": state.get("turns", 0) + 1,
        }
        if not tool_uses:
            # De tool-loze beurt is het eindantwoord: dát is de leesbare `token`-stroom (de annotatie-
            # route levert JSON, geen antwoord — daar geen token; annoteer_node vat samen).
            antwoord = "\n\n".join(p for p in text_parts if p)
            upd["answer"] = antwoord
            if stream_naar_denk and antwoord:
                writer({"type": "token", "content": antwoord})
        return upd

    def route_after_agent(state: State) -> str:
        if state.get("pending_tools") and state.get("turns", 0) < settings.max_turns:
            return "tools"
        if state.get("specialist") == "annotatie":
            return "annoteer"  # ophaal-agent klaar → de aparte annoteer-stap
        return "verify"

    def annoteer_node(state: State) -> dict[str, Any]:
        """Aparte annoteer-stap: de ophaal-agent heeft de bepaling opgehaald (in de source_trace).
        Hier doet een PURE LLM-call (geen tools) de JAS-analyse op ALLEEN die tekst en gronden we elk
        element ertegen. De gegronde voorstellen gaan naar de state; de aparte critic_node scoort ze en
        emit ze dán als `element`-events. annoteer emit alléén `doel` (en een melding bij lege uitkomst)."""
        writer = get_stream_writer()
        doel = _bepaal_doel(state)
        corpus = _corpus_uit_trace(state.get("source_trace", []))
        aanduiding = doel.get("artikel") or doel.get("nummer") or ""

        if not corpus.strip():
            melding = (
                "Ik kon de gevraagde bepaling niet ophalen om te annoteren — controleer de wet en het "
                "artikel/lid (bij een beleidsregel bv. '9.1')."
            )
            writer({"type": "token", "content": melding})
            return {"answer": melding, "voorstellen": [], "messages": [{"role": "assistant", "content": melding}]}

        resp = llm.create(
            model=model,
            max_tokens=8192,
            system=annotatie_systeemprompt(),
            tools=[],
            messages=[{"role": "user", "content": annotatie_userprompt(doel.get("bwbId", ""), aanduiding, corpus, doel.get("lid", ""))}],
        )
        llm_text = "".join(b.text for b in resp.content if b.type == "text")
        voorstellen, verworpen = _verwerk(llm_text, corpus, doel.get("bwbId", ""), aanduiding, doel.get("lid", ""))

        # Stuur de opgehaalde tekst mee zodat de frontend precies dít toont (één bron, ook voor divisies).
        doel_uit = {**doel, "leden_teksten": [{"lid": doel.get("lid", ""), "tekst": corpus}]}
        writer({"type": "doel", "doel": doel_uit})
        if not voorstellen:
            plek = f"artikel {aanduiding}" + (f" lid {doel['lid']}" if doel.get("lid") else "")
            leeg = f"Ik vond geen JAS-elementen om te markeren in {plek}."
            writer({"type": "token", "content": leeg})
            return {"answer": leeg, "voorstellen": [], "verworpen_fragmenten": [],
                    "messages": [{"role": "assistant", "content": leeg}]}
        # De verworpen fragmenten gaan mee de state in: de herzieningsronde (zie `route_na_critic`)
        # kan het model daarmee zijn eigen bijna-goede citaten laten repareren.
        return {
            "voorstellen": [v.model_dump() for v in voorstellen],
            "verworpen_fragmenten": [x.model_dump() for x in verworpen],
            "answer": "",
        }

    def critic_node(state: State) -> dict[str, Any]:
        """Critic-pas: controleert de gegronde voorstellen vóór de jurist en zet per element een
        aandacht-niveau (groen/geel/rood) + korte motivatie, plus een lijst waarschijnlijk ontbrekende
        elementen. Eén LLM-call (geen tools). Faalt de Critic → elementen komen gewoon door met lege
        aandacht (nooit de annotatie breken). Emit de `element`-events + één `ontbrekend`-event + de
        samenvattings-`token`."""
        writer = get_stream_writer()
        voorstellen = list(state.get("voorstellen") or [])
        if not voorstellen:
            return {}  # annoteer_node heeft de lege/foutmelding al geëmit

        doel = _bepaal_doel(state)
        corpus = _corpus_uit_trace(state.get("source_trace", []))
        aanduiding = doel.get("artikel") or doel.get("nummer") or ""

        oordelen: dict[str, Any] = {}
        ontbrekend: list[Any] = []
        gefaald = False
        try:
            resp = llm.create(
                model=model,
                max_tokens=2048,
                system=critic_systeemprompt(),
                tools=[],
                messages=[{"role": "user", "content": critic_userprompt(voorstellen, corpus)}],
            )
            crit_text = "".join(b.text for b in resp.content if b.type == "text")
            oordelen, ontbrekend = _verwerk_critic(crit_text, [str(v.get("id", "")) for v in voorstellen])
        except Exception:  # noqa: BLE001 — Critic mag de annotatie nooit breken
            gefaald = True
            logger.warning("critic: beoordeling mislukt; elementen zonder aandacht doorgelaten", exc_info=True)

        met_aandacht = 0
        feedback: list[dict[str, Any]] = []
        for v in voorstellen:
            oordeel = oordelen.get(str(v.get("id", "")))
            aandacht = oordeel.aandacht if oordeel else ""
            motivatie = oordeel.motivatie if oordeel else ""
            # Deterministische regel: aanwezige alternatieven = disambiguatie = minimaal 'geel'.
            if v.get("alternatieven") and aandacht in ("", "groen"):
                aandacht = "geel"
                motivatie = motivatie or "Er zijn plausibele alternatieve klassen."
            v["aandacht"] = aandacht
            v["critic"] = motivatie
            if aandacht in ("geel", "rood"):
                met_aandacht += 1
            if oordeel is not None:
                feedback.append({"id": v.get("id", ""), **oordeel.model_dump()})
            writer({"type": "element", "element": v})

        writer({"type": "ontbrekend", "items": [o.model_dump() for o in ontbrekend]})

        plek = f"artikel {aanduiding}" + (f" lid {doel['lid']}" if doel.get("lid") else "")
        delen = [f"Ik heb {len(voorstellen)} JAS-elementen voorgesteld voor {plek}"]
        if met_aandacht:
            delen.append(f"{met_aandacht} met aandacht")
        if ontbrekend:
            delen.append(f"{len(ontbrekend)} mogelijk ontbrekend")
        samenvatting = "; ".join(delen) + "."
        writer({"type": "token", "content": samenvatting})
        # Geheugen: leg een leesbaar spoor van de annotatie vast (met de elementen) zodat een
        # vervolgvraag ("waarom Rechtssubject?") context heeft. De `element`-events/SSE blijven ongewijzigd.
        elems = "; ".join(f"{v.get('klasse', '')}: '{truncate(str(v.get('tekst', '')), 80)}'" for v in voorstellen[:12])
        geheugen = f"[Annotatie {plek}] Ik markeerde {len(voorstellen)} JAS-elementen: {elems}" + (
            " (…)" if len(voorstellen) > 12 else "."
        )
        # `voorstellen` expliciet teruggeven: eerder werkten de aandacht-velden alleen door omdat het
        # dezelfde dict-objecten waren. Dat is fragiel zodra er meerdere rondes over de state lopen.
        return {
            "answer": samenvatting,
            "voorstellen": voorstellen,
            "critic_feedback": feedback,
            "critic_ontbrekend": [o.model_dump() for o in ontbrekend],
            "critic_gefaald": gefaald,
            "messages": [{"role": "assistant", "content": geheugen}],
        }

    def tools_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()
        pending = state.get("pending_tools", [])
        writer({"type": "status", "message": f"Graaf bevragen: {', '.join(t['name'] for t in pending)}..."})
        trace = list(state.get("source_trace", []))
        results = []
        for tu in pending:
            result_text = truncate(dispatch(tu["name"], graph, tu["input"], settings))
            trace.append((tu["name"], result_text))
            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
        return {
            "messages": [{"role": "user", "content": results}],  # delta
            "source_trace": trace,
            "pending_tools": [],
        }

    def verify_node(state: State) -> dict[str, Any]:
        report = check_grounding(state.get("answer", ""), state.get("source_trace", []))
        return {"grounded": report.grounded, "cited": len(report.cited), "unsupported": report.unsupported}

    def route_after_verify(state: State) -> str:
        if not state.get("grounded", True) and settings.grounding_correct and not state.get("corrected"):
            return "correct"
        return "finalize"

    def correct_node(state: State) -> dict[str, Any]:
        bad = ", ".join(state.get("unsupported", []))
        return {
            "messages": [{
                "role": "user",
                "content": (
                    f"Let op: je noemde verwijzing(en) {bad} die niet uit de graaf-resultaten kwamen. "
                    "Corrigeer je antwoord: onderbouw ze met de tools of verwijder ze."
                ),
            }],
            "corrected": True,
            "answer": "",
        }

    def finalize_node(state: State) -> dict[str, Any]:
        writer = get_stream_writer()

        # Vangnet tegen een stil leeg antwoord. Dat kan gebeuren als de agent een lege tekstbeurt
        # levert, of nadat correct_node het antwoord heeft gewist voor een grounding-correctie die
        # daarna niets oplevert. De gebruiker zag dan alleen de bronnen en de frontend-fallback
        # "(geen antwoord)" — zonder spoor in de logs. Liever een eerlijke melding, en altijd een
        # logregel zodat het volgende geval terug te vinden is.
        antwoord = state.get("answer", "") or ""
        if not antwoord.strip():
            reden = "grounding-correctie leverde geen antwoord" if state.get("corrected") else "lege antwoordbeurt"
            logger.warning(
                "leeg antwoord in finalize",
                extra={
                    "reden": reden,
                    "turns": state.get("turns", 0),
                    "specialist": state.get("specialist"),
                    "grounded": state.get("grounded", True),
                    "unsupported": state.get("unsupported", []),
                    "bronnen": len(state.get("source_trace", []) or []),
                },
            )
            antwoord = (
                "Ik kon op basis van de geraadpleegde bronnen geen antwoord formuleren. "
                "De gevonden bronnen staan hieronder; stel de vraag eventueel gerichter "
                "(bijvoorbeeld met een specifiek artikel of lid)."
            )
            writer({"type": "token", "content": antwoord})
            state = {**state, "answer": antwoord}

        sources = collect_sources(state.get("source_trace", []))
        if settings.curate_sources:
            sources = curate_sources(sources, state.get("answer", ""))
        src_dicts = [s.model_dump() for s in sources]
        writer({"type": "sources", "sources": src_dicts})
        writer({
            "type": "grounding",
            "grounded": state.get("grounded", True),
            "cited": state.get("cited", 0),
            "unsupported": state.get("unsupported", []),
        })
        # entiteit-tier: alleen nieuwe IRI's toevoegen (append-reducer + dedup).
        existing = set(state.get("entities_seen") or [])
        new = [s["uri"] for s in src_dicts if s["uri"] not in existing]
        upd: dict[str, Any] = {"sources": src_dicts, "entities_seen": new}
        # In de decompositie-stroom stroomt het eind-antwoord uit synthesize_node en is het nog niet
        # in het durabele messages-kanaal beland (agent_node doet dat in de één-loop-stroom). Voeg het
        # hier één keer toe zodat het gespreksgeheugen het antwoord onthoudt.
        if settings.enable_decomposition:
            upd["messages"] = [
                {"role": "assistant", "content": [{"type": "text", "text": state.get("answer", "")}]}
            ]
        return upd

    # ---- Decompositie-nodes (multi-hop; alleen actief bij enable_decomposition) --------------------

    def decompose_node(state: State) -> dict[str, Any]:
        """Splits de vraag in geordende deelvragen (één LLM-call). Enkelvoudig → één deelvraag."""
        writer = get_stream_writer()
        resp = llm.create(
            model=model,
            max_tokens=400,
            system=_DECOMPOSE_SYSTEM + _memory_context(state),
            tools=[],
            messages=[{"role": "user", "content": state["question"]}],
        )
        text = "".join(b.text for b in resp.content if b.type == "text")
        subs: list[str] = []
        for line in text.splitlines():
            m = re.match(r"^\s*\d+[.)]\s*(.+)$", line)
            if m:
                subs.append(m.group(1).strip())
        if not subs:
            subs = [state["question"]]
        subs = subs[: settings.max_subquestions]
        if len(subs) > 1:
            writer({"type": "status", "message": f"Opgesplitst in {len(subs)} deelvragen."})
        return {"sub_questions": subs}

    def solve_node(state: State) -> dict[str, Any]:
        """Beantwoord elke deelvraag met een eigen agent⇄tools-loop (lokale scratch-messages).

        De per-beurt narratie stroomt als `reason` (het denkproces), nooit als `token`. Bij ÉÉN
        deelvraag (een simpele vraag) is er geen aparte synthese nodig: de tool-loze eindbeurt ís het
        eindantwoord en wordt als één `token` geëmit (en `answer` gezet), zodat een eenvoudige vraag
        geen synthese-tax betaalt. Bij MEERDERE deelvragen emit solve géén token — `synthesize_node`
        streamt dan het eindantwoord. De gedeelde source_trace accumuleert over álle deelvragen zodat
        grounding/provenance ongewijzigd werken.
        """
        writer = get_stream_writer()
        spec = get_specialist(state.get("specialist"))
        subs = state.get("sub_questions") or [state["question"]]
        enkelvoudig = len(subs) == 1  # simpele vraag: eindantwoord hier, synthese overslaan
        base_system = SYSTEM_PROMPT + (f"\n\n{spec.system}" if spec.system else "")
        schemas = anthropic_schemas(only=spec.tools)
        trace = list(state.get("source_trace", []))
        findings: list[dict[str, str]] = []
        for i, sub in enumerate(subs, 1):
            if len(subs) > 1:
                writer({"type": "status", "message": f"Deelvraag {i}/{len(subs)}: {sub[:80]}"})
            system = base_system
            if findings:
                ctx = "\n".join(f"- {f['vraag']} → {f['antwoord'][:300]}" for f in findings)
                system += (
                    "\n\nEERDERE DEELBEVINDINGEN (context; verifieer elk feit opnieuw via de tools):\n" + ctx
                )
            system += _memory_context(state)
            msgs: list[dict[str, Any]] = [{"role": "user", "content": sub}]
            antwoord = ""
            for _turn in range(settings.sub_max_turns):
                # Op de laatste toegestane beurt bieden we géén tools meer aan. Zonder dat kon het
                # model blijven zoeken tot de lus afliep, waarna `antwoord` leeg bleef en de
                # gebruiker alleen bronnen zag: de vraag werd midden in de zoektocht afgekapt. Nu is
                # de laatste beurt gedwongen een antwoord op wat er is opgehaald.
                laatste_beurt = _turn == settings.sub_max_turns - 1
                if laatste_beurt:
                    writer({"type": "status", "message": "Beurtlimiet bereikt — antwoord opstellen uit wat is gevonden"})
                with llm.stream(
                    model=model, max_tokens=4096, system=system,
                    tools=[] if laatste_beurt else schemas,
                    messages=_trim_messages(_schoon_messages(msgs), settings.max_history_chars),
                ) as stream:
                    first = True
                    for delta in stream.text_deltas:
                        if first and _turn > 0:
                            writer({"type": "reason", "content": "\n\n"})  # alinea-scheiding tussen beurten
                        writer({"type": "reason", "content": delta})
                        first = False
                    final = stream.final_message()
                tool_uses, text_parts = _parse_final(final)
                assistant_content: list[dict[str, Any]] = [{"type": "text", "text": p} for p in text_parts if p and p.strip()]
                assistant_content += [
                    {"type": "tool_use", "id": t["id"], "name": t["name"], "input": t["input"]}
                    for t in tool_uses
                ]
                msgs.append({"role": "assistant", "content": assistant_content})
                if not tool_uses:
                    antwoord = "\n\n".join(p for p in text_parts if p)
                    break
                writer({"type": "status", "message": f"Graaf bevragen: {', '.join(t['name'] for t in tool_uses)}..."})
                results = []
                for tu in tool_uses:
                    result_text = truncate(dispatch(tu["name"], graph, tu["input"], settings))
                    trace.append((tu["name"], result_text))
                    results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": result_text})
                msgs.append({"role": "user", "content": results})
            if not antwoord.strip():
                # Zou na het tools-loze vangnet hierboven niet meer moeten voorkomen; als het tóch
                # gebeurt is dat een lege modelrespons en willen we het terugvinden.
                logger.warning(
                    "deelvraag zonder antwoord",
                    extra={"deelvraag": sub[:120], "beurten": settings.sub_max_turns,
                           "specialist": state.get("specialist"), "bronnen": len(trace)},
                )
            findings.append({"vraag": sub, "antwoord": antwoord})
        upd: dict[str, Any] = {"sub_findings": findings, "source_trace": trace}
        if enkelvoudig:
            # Simpele vraag: de tool-loze eindbeurt ís het eind-antwoord (geen synthese) → als token.
            antwoord = findings[0]["antwoord"] if findings else ""
            upd["answer"] = antwoord
            if antwoord:
                writer({"type": "token", "content": antwoord})
        return upd

    def route_after_solve(state: State) -> str:
        # Eén deelvraag → antwoord staat al (gestreamd in solve); sla de synthese over.
        return "verify" if len(state.get("sub_questions") or []) <= 1 else "synthesize"

    def synthesize_node(state: State) -> dict[str, Any]:
        """Stel het eind-antwoord samen uit de deelbevindingen (streamt de tokens)."""
        writer = get_stream_writer()
        findings = state.get("sub_findings") or []
        bevindingen = "\n\n".join(
            f"DEELVRAAG: {f['vraag']}\nBEVINDING: {f['antwoord']}" for f in findings
        )
        system = _SYNTHESE_SYSTEM
        if state.get("corrected") and state.get("unsupported"):
            system += (
                "\n\nVerwijder of onderbouw deze eerder niet-gegronde verwijzingen: "
                + ", ".join(state["unsupported"]) + "."
            )
        user = f"OORSPRONKELIJKE VRAAG:\n{state['question']}\n\nBEVINDINGEN PER DEELVRAAG:\n{bevindingen}"
        parts: list[str] = []
        with llm.stream(
            model=model, max_tokens=4096, system=system, tools=[],
            messages=[{"role": "user", "content": user}],
        ) as stream:
            for delta in stream.text_deltas:
                parts.append(delta)
                writer({"type": "token", "content": delta})
            stream.final_message()
        return {"answer": "".join(parts).strip()}

    def resynth_node(state: State) -> dict[str, Any]:
        """Ongegronde synthese → markeer voor één her-synthese (synthesize_node leest corrected)."""
        return {"corrected": True, "answer": ""}

    g = StateGraph(State)
    g.add_node("verify", verify_node)
    g.add_node("finalize", finalize_node)

    if settings.enable_decomposition:
        # Supervisor → (annotatie: agent⇄tools→annoteer_finalize | antwoord: decompose→solve→…→
        # finalize) → advance → (volgende worker | einde).
        g.add_node("supervisor", supervisor_node)
        g.add_node("decompose", decompose_node)
        g.add_node("solve", solve_node)
        g.add_node("synthesize", synthesize_node)
        g.add_node("resynth", resynth_node)
        g.add_node("agent", agent_node)
        g.add_node("tools", tools_node)
        g.add_node("annoteer", annoteer_node)
        g.add_node("critic", critic_node)
        g.add_node("advance", advance_node)
        entrymap = {"agent": "agent", "decompose": "decompose"}
        g.add_edge(START, "supervisor")
        g.add_conditional_edges("supervisor", _entry_node, entrymap)
        g.add_edge("decompose", "solve")
        g.add_conditional_edges("solve", route_after_solve, {"verify": "verify", "synthesize": "synthesize"})
        g.add_edge("synthesize", "verify")
        g.add_conditional_edges("verify", route_after_verify, {"correct": "resynth", "finalize": "finalize"})
        g.add_edge("resynth", "synthesize")
        g.add_conditional_edges(
            "agent", route_after_agent,
            {"tools": "tools", "verify": "verify", "annoteer": "annoteer"},
        )
        g.add_edge("tools", "agent")
        g.add_edge("finalize", "advance")
        g.add_edge("annoteer", "critic")
        g.add_edge("critic", "advance")
        g.add_conditional_edges("advance", route_after_advance, {**entrymap, "einde": END})
        return g

    # Één-loop-stroom.
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("correct", correct_node)

    if settings.enable_planning:
        # Supervisor → agent⇄tools → (verify→finalize | annoteer_finalize) → advance → (volgende | einde).
        g.add_node("supervisor", supervisor_node)
        g.add_node("annoteer", annoteer_node)
        g.add_node("critic", critic_node)
        g.add_node("advance", advance_node)
        g.add_edge(START, "supervisor")
        g.add_conditional_edges("supervisor", _entry_node, {"agent": "agent"})
        g.add_conditional_edges(
            "agent", route_after_agent,
            {"tools": "tools", "verify": "verify", "annoteer": "annoteer"},
        )
        g.add_edge("tools", "agent")
        g.add_conditional_edges("verify", route_after_verify, {"correct": "correct", "finalize": "finalize"})
        g.add_edge("correct", "agent")
        g.add_edge("finalize", "advance")
        g.add_edge("annoteer", "critic")
        g.add_edge("critic", "advance")
        g.add_conditional_edges("advance", route_after_advance, {"agent": "agent", "einde": END})
        return g

    # Geen classificatie (planning off, decomp off): pure QA-agent, ongewijzigd (geen annotatie-route).
    g.add_edge(START, "agent")
    g.add_conditional_edges("agent", route_after_agent, {"tools": "tools", "verify": "verify"})
    g.add_edge("tools", "agent")
    g.add_conditional_edges("verify", route_after_verify, {"correct": "correct", "finalize": "finalize"})
    g.add_edge("correct", "agent")
    g.add_edge("finalize", END)
    return g
