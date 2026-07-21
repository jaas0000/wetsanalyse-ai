"""Intent-parse voor de agent-ingang van de workbench.

Zet een vrije vraag ("annoteer art. 9 lid 1 IW") om naar een gestructureerd doel
{bwbId, artikel, lid} + een leesbare bevestiging. Eén LLM-call, **gegrond op de meegegeven
wet-catalogus** (bwbId + naam) zodat een gesproken wetnaam/afkorting op een echte bwbId mapt;
lukt dat niet met zekerheid, dan komt er een verduidelijkingsvraag terug i.p.v. een gok.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import Settings
from .ports import LLMPort

logger = logging.getLogger("graph_qa.intent")

_SYSTEEM = (
    "Je bent een intentie-parser voor een juridische annotatie-workbench. Gegeven een verzoek en een "
    "lijst beschikbare wetten (elk met bwbId + naam), bepaal welk ARTIKEL (en eventueel LID) van welke "
    "WET geannoteerd moet worden.\n"
    "Antwoord UITSLUITEND met JSON, zonder omliggende tekst:\n"
    '{"bwbId": "", "artikel": "", "lid": "", "wetnaam": "", "vraag": ""}\n'
    "Regels:\n"
    "- Kies bwbId ALLEEN uit de gegeven lijst (match op naam of gangbare afkorting, bijv. 'IW' → "
    "'Invorderingswet 1990'). Verzin nooit een bwbId.\n"
    "- artikel is het nummer/aanduiding zonder het woord 'artikel'. lid alleen als het genoemd is.\n"
    "- Kun je de wet of het artikel niet met zekerheid bepalen (of staat de wet niet in de lijst), "
    "laat bwbId/artikel leeg en zet in 'vraag' een korte verduidelijkingsvraag in het Nederlands."
)


def _userprompt(prompt: str, catalogus: list[dict[str, str]]) -> str:
    regels = "\n".join(f'- {c.get("bwbId","")}: {c.get("naam","")}' for c in catalogus) or "(leeg)"
    return f"Beschikbare wetten:\n{regels}\n\nVerzoek van de gebruiker:\n{prompt}"


def _json(text: str) -> dict[str, Any]:
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e > s:
        try:
            data = json.loads(text[s : e + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {}


_DEFAULT_VRAAG = (
    "Ik kon niet bepalen welk artikel van welke wet je bedoelt. Noem de wet (uit de catalogus) en het "
    "artikelnummer, bijv. 'annoteer artikel 9 van de Invorderingswet 1990'."
)


def parse_intent_sync(
    prompt: str,
    catalogus: list[dict[str, str]],
    settings: Settings,
    llm: LLMPort,
) -> dict:
    resp = llm.create(
        model=settings.llm_model,
        max_tokens=400,
        system=_SYSTEEM,
        tools=[],
        messages=[{"role": "user", "content": _userprompt(prompt, catalogus)}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    data = _json(text)

    bwb = str(data.get("bwbId", "")).strip()
    artikel = str(data.get("artikel", "")).strip()
    lid = str(data.get("lid", "")).strip()
    wetnaam = str(data.get("wetnaam", "")).strip()
    vraag = str(data.get("vraag", "")).strip()

    geldig = {str(c.get("bwbId", "")).strip() for c in catalogus if c.get("bwbId")}
    if bwb and bwb in geldig and artikel and not vraag:
        if not wetnaam:
            wetnaam = next((c.get("naam", "") for c in catalogus if c.get("bwbId") == bwb), bwb)
        bevestiging = f"Ik ga {wetnaam} artikel {artikel}" + (f" lid {lid}" if lid else "") + " annoteren."
        return {
            "begrepen": {"bwbId": bwb, "artikel": artikel, "lid": lid, "wetnaam": wetnaam},
            "bevestiging": bevestiging,
            "vraag": "",
        }

    return {"begrepen": None, "bevestiging": "", "vraag": vraag or _DEFAULT_VRAAG}
