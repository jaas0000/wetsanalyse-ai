"""Agentische act-2-worker — vervangt de deterministische `steps.genereer_act2_bron` + de
losse verwijzing-inventaris/fetch-lus door één agent⇄tools-loop op de job-modelprofiel-LLM.

Per bron krijgt het model de bepaling (brongetrouw uit GraphDB) plus twee tools:
- `haal_verwijzing(bwbId, artikel, lid?)` — haalt de tekst van een verwezen bepaling uit de graaf
  (begrensd door `max_verwijzing_fetches`), zodat het de betekenis brongetrouw kan invullen;
- `lever_analyse(markeringen, verwijzingen, …)` — levert het eindresultaat in.

De uitvoer heeft **dezelfde vorm** als `steps.genereer_act2_bron` (merge via `steps._merge_bron`,
provenance via `steps._prov`), zodat de orchestrator-merge én de **harde gate** (brongetrouwheid +
JAS-schema, nu tegen het graaf-corpus) ongewijzigd blijven. De worker filtert niets stil weg — de
gate + auto-correctie in `_afronden_ronde` handhaven brongetrouwheid (schending → `fout`).

Grounding-benadering gespiegeld op `tools/graph-qa/agent/annotatie.py` (letterlijk fragment in de
opgehaalde tekst); hier alleen als prompt-eis, de deterministische toets blijft de orchestrator-gate.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from ..llm.base import LLMClient, parse_json_strict
from . import prompts, steps
from .. import graph_source
from ..graphdb import GraphDBClient

# Optionele live-event-sink (SSE): (event_type, data) -> None. None = headless.
Emit = Callable[[str, dict], Awaitable[None]]

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "haal_verwijzing",
            "description": (
                "Haal de letterlijke tekst van een verwezen bepaling uit de kennisgraaf, zodat je "
                "de betekenis van een verwijzing brongetrouw kunt invullen. Gebruik dit alleen voor "
                "verwijzingen die de betekenis/werking van de focus-bepaling bepalen "
                "(definitie/schakel/relevante delegatie)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "bwbId": {"type": "string", "description": "BWB-id van de doelregeling, bv. BWBR0002320"},
                    "artikel": {"type": "string", "description": "Artikelnummer, bv. '1' of '9.1'"},
                    "lid": {"type": "string", "description": "Optioneel lidnummer"},
                },
                "required": ["bwbId", "artikel"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lever_analyse",
            "description": (
                "Lever het eindresultaat van activiteit 2 voor deze bron in: de markeringen (elk met "
                "een LETTERLIJK citaat uit de leden-tekst) en de uitgaande verwijzingen. Roep dit één "
                "keer aan als je klaar bent."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "markeringen": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "formulering": {"type": "string", "description": "letterlijk citaat uit de leden-tekst"},
                                "klasse": {"type": "string", "description": "één van de 13 JAS-klassen"},
                                "vindplaats": {"type": "string", "description": "bv. 'lid 2'"},
                                "toelichting": {"type": "string"},
                                "twijfel": {"type": "string"},
                            },
                            "required": ["id", "formulering", "klasse"],
                        },
                    },
                    "verwijzingen": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "bron_lid": {"type": "string"},
                                "soort": {"type": "string"},
                                "functie": {"type": "string"},
                                "doel": {"type": "object"},
                                "status": {"type": "string"},
                                "betekenis": {"type": "string"},
                            },
                            "required": ["id"],
                        },
                    },
                    "samenhang": {"type": "string"},
                    "type": {"type": "string"},
                    "reikwijdte": {"type": "string"},
                    "geraadpleegde": {"type": "string"},
                },
                "required": ["markeringen"],
            },
        },
    },
]


def _graph_verwijzingen_blok(basis: dict) -> str:
    kand = basis.get("graph_verwijzingen") or []
    if not kand:
        return "\n\n(De graaf tagde geen expliciete verwijzingen; let zelf op natuurlijke-taalverwijzingen.)"
    regels = ["\n\nDoor de graaf getagde uitgaande verwijzingen (kandidaten; vul aan met "
              "natuurlijke-taalverwijzingen):"]
    for v in kand:
        soort = f"{v.get('soort','')}".strip()
        doel = f"{v.get('doelSoort','')}".strip()
        regels.append(f"- \"{v.get('anker','')}\" → {v.get('naar','')} ({soort}{'/' + doel if doel else ''})")
    return "\n".join(regels)


def _agent_prompt(basis: dict, analysefocus: str | None) -> tuple[str, str, str]:
    system = prompts._system(prompts._REF_JAS, prompts._REF_VERWIJZINGEN) + (
        "\n\nJe hebt twee tools: `haal_verwijzing` om de tekst van een verwezen bepaling uit de "
        "kennisgraaf op te halen (gebruik het spaarzaam, alleen voor betekenisbepalende verwijzingen), "
        "en `lever_analyse` om je eindresultaat in te leveren. Werk uitsluitend met de aangeleverde en "
        "de via de tool opgehaalde tekst; verzin niets."
    )
    user = (
        "=== WETTEKST OM TE ANALYSEREN ===\n"
        + prompts._leden_blok(basis)
        + _graph_verwijzingen_blok(basis)
        + prompts._focus_blok(analysefocus)
        + "\n\nOPDRACHT (activiteit 2): markeer fijnmazig de relevante formuleringen (vrijwel elk lid "
        "bevat meerdere markeringen) en ken elke markering één JAS-klasse toe. Elke 'formulering' MOET "
        "een letterlijk citaat uit de bovenstaande leden-tekst zijn. Inventariseer de uitgaande "
        "verwijzingen (getagde kandidaten + natuurlijke-taalverwijzingen), volg de betekenisbepalende "
        "via `haal_verwijzing`, en vul per verwijzing 'functie'/'status'/'betekenis' in (citeer in "
        "'betekenis' waar relevant LETTERLIJK uit de opgehaalde tekst). Gebruik stabiele id's "
        "(m1.., v1..). Roep tot slot `lever_analyse` aan met het volledige resultaat."
    )
    return system, user, prompts._hash(system, user)


async def genereer_act2_bron_agentisch(
    llm: LLMClient,
    graph: GraphDBClient,
    bron_basis: dict,
    ronde: int,
    analysefocus: str | None,
    *,
    max_verwijzing_fetches: int,
    max_iters: int = 12,
    emit: Emit | None = None,
) -> tuple[dict, dict]:
    """Genereer markeringen/verwijzingen voor ÉÉN bron via de agent⇄tools-loop en merge met de
    brongetrouwe (graaf-)basis. Drop-in voor `steps.genereer_act2_bron`."""
    captured: dict = {}
    fetches = {"n": 0}

    async def execute(naam: str, args: dict) -> str:
        if naam == "haal_verwijzing":
            if fetches["n"] >= max(0, max_verwijzing_fetches):
                return "(fetch-limiet bereikt — werk met de reeds opgehaalde tekst)"
            fetches["n"] += 1
            bwb = str(args.get("bwbId", "")).strip()
            art = str(args.get("artikel", "")).strip()
            lid = (str(args.get("lid") or "").strip() or None)
            if emit:
                await emit("reason", {"tekst": f"verwijzing volgen: {bwb} art. {art}" + (f" lid {lid}" if lid else "")})
            try:
                ref = await graph_source.haal_bron_basis(graph, "ref", bwb, art, lid)
            except Exception as e:  # noqa: BLE001 — een gefaalde fetch degradeert stil (tekst terug aan het model)
                return f"(ophalen mislukt: {e})"
            if not ref["leden"]:
                return "(geen tekst gevonden in de graaf voor deze verwijzing)"
            return "\n".join(f"Lid {l['lid']}: {l['tekst']}" for l in ref["leden"])
        if naam == "lever_analyse":
            captured.clear()
            captured.update(args if isinstance(args, dict) else {})
            return "ontvangen"
        return f"(onbekende tool: {naam})"

    system, user, phash = _agent_prompt(bron_basis, analysefocus)
    if emit:
        await emit("status", {"fase": "agent-markeren", "bron_id": bron_basis.get("bron_id", "")})
    res = await llm.run_tools(system, user, tools=_TOOLS, execute=execute, max_iters=max_iters)

    payload = captured if captured.get("markeringen") is not None else _fallback(res.ruwe_tekst)
    if emit:
        for m in payload.get("markeringen") or []:
            await emit("element", {"klasse": m.get("klasse", ""), "tekst": m.get("formulering", "")})

    basis_voor_merge = {k: v for k, v in bron_basis.items() if k != "graph_verwijzingen"}
    return steps._merge_bron(basis_voor_merge, payload), steps._prov("2", ronde, res, phash, bron_basis)


def _fallback(tekst: str) -> dict:
    """Gaf het model geen `lever_analyse`-call maar losse JSON-tekst, probeer die alsnog te parsen.
    Lukt dat niet, dan een lege payload — de harde gate (schema-check) blokkeert een lege ronde."""
    try:
        data = parse_json_strict(tekst)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}
