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

from .annotatie_prompt import annotatie_systeemprompt


@dataclass(frozen=True)
class Specialist:
    system: str
    tools: frozenset[str] | None  # None = alle tools


# De annotatie-worker: haalt de tekst zelf op via de tools (net als de chatbot) en levert JAS-elementen
# als JSON. Overschrijft bewust de QA-antwoordinstructies uit SYSTEM_PROMPT.
_ANNOTATIE_SYSTEM = (
    "LET OP — voor deze taak geldt NIET de antwoord-werkwijze hierboven. Je taak is ANNOTEREN, niet "
    "vragen beantwoorden.\n\n"
    + annotatie_systeemprompt()
    + "\n\nOPHALEN (agent-werkwijze): bepaal welk artikel — en indien genoemd welk LID — de gebruiker "
    "wil annoteren. Ken je de bwbId nog niet, zoek die dan met search_wetgeving. Haal de tekst op met "
    "get_lid (als er een lid is genoemd) of get_artikel (heel artikel), en annoteer UITSLUITEND die "
    "opgehaalde tekst. Geef daarna je JSON terug, uitgebreid met een `doel`-object dat vertelt wat je "
    "hebt opgehaald:\n"
    '{"doel": {"bwbId": "<BWBR…>", "artikel": "<nr>", "lid": "<lidnummer of leeg>"}, '
    '"elementen": [ … ]}\n'
    "Gebruik in `doel` exact de bwbId/artikel/lid die je aan get_lid/get_artikel meegaf; verzin niets."
)


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
    "annotatie": Specialist(
        system=_ANNOTATIE_SYSTEM,
        tools=frozenset({
            "search_wetgeving", "get_lid", "get_artikel", "get_regeling_info", "resolve_begrip",
        }),
    ),
}

DEFAULT = "algemeen"


def get(name: str | None) -> Specialist:
    """Specialist op naam; valt terug op 'algemeen' bij onbekend/leeg."""
    return SPECIALISTS.get((name or "").strip().lower(), SPECIALISTS[DEFAULT])
