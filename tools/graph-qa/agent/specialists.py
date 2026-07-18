"""
Specialisten voor het supervisor-patroon (multi-agent).

Een specialist is een **declaratieve config**: een focus-prompt bovenop SYSTEM_PROMPT +
een toegestane tool-subset. De router (agent/orchestrator.py) kiest er één per vraag; de
agent-node draait daarna de gewone agent↔tools-lus met die config. Zo delen alle
specialisten dezelfde tool-laag, grounding en geheugen — het verschil zit in gedrag en
tool-bereik. Uitbreiden = een entry toevoegen (bv. later een regelspraak-specialist).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Specialist:
    system: str
    tools: frozenset[str] | None  # None = alle tools


SPECIALISTS: dict[str, Specialist] = {
    "definitie": Specialist(
        system=(
            "Je bent de DEFINITIE-specialist. Je herleidt en verklaart juridische begrippen. "
            "Begin bij resolve_begrip en de definitieartikelen; citeer de brondefinitie letterlijk "
            "met vindplaats en benoem of het een wettelijke definitie of interpretatie is."
        ),
        tools=frozenset({
            "resolve_begrip", "search_wetgeving", "semantic_search",
            "get_artikel", "get_lid", "graph_schema", "raw_sparql",
        }),
    ),
    "duiding": Specialist(
        system=(
            "Je bent de DUIDINGS-specialist. Je legt de betekenis, structuur en samenhang van een "
            "bepaling uit. Gebruik get_context voor de bepaling met haar structuur en verwijzingen, "
            "en follow_verwijzingen/referenced_by om kruisverwijzingen te volgen."
        ),
        tools=frozenset({
            "get_context", "get_artikel", "get_lid", "follow_verwijzingen", "referenced_by",
            "search_wetgeving", "semantic_search", "graph_schema", "raw_sparql",
        }),
    ),
    "algemeen": Specialist(system="", tools=None),
}

DEFAULT = "algemeen"


def get(name: str | None) -> Specialist:
    """Specialist op naam; valt terug op 'algemeen' bij onbekend/leeg."""
    return SPECIALISTS.get((name or "").strip().lower(), SPECIALISTS[DEFAULT])
