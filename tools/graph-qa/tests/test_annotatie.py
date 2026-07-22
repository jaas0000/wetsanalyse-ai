"""Robuuste JAS-JSON-parser (_parse_elementen) — de grounding-helper die de annoteer-stap gebruikt."""
from __future__ import annotations

from agent.annotatie import _parse_elementen


def test_parse_fenced_json():
    txt = '```json\n{"elementen": [{"klasse": "Rechtssubject", "tekst": "de ontvanger"}]}\n```'
    els = _parse_elementen(txt)
    assert len(els) == 1 and els[0]["klasse"] == "Rechtssubject"


def test_parse_proza_rondom_json():
    txt = 'Hier is mijn analyse:\n{"elementen": [{"klasse": "Voorwaarde", "tekst": "indien"}]}\nEinde.'
    els = _parse_elementen(txt)
    assert len(els) == 1 and els[0]["tekst"] == "indien"


def test_parse_afgekapt_salvaget_complete_elementen():
    # geldig element 1 (compleet), element 2 afgekapt op max_tokens (geen sluit-}) → salvage houdt 1.
    txt = (
        '{"elementen": [{"klasse": "Rechtssubject", "tekst": "de ontvanger", "toelichting": "wie"}, '
        '{"klasse": "Rechtsbetrekking", "tekst": "kan uitstel'
    )
    els = _parse_elementen(txt)
    assert len(els) == 1 and els[0]["klasse"] == "Rechtssubject"


def test_parse_alternatieven_niet_als_element():
    # een genest Alternatief-object (klasse+motivatie, geen tekst) telt niet als element.
    txt = (
        '{"elementen": [{"klasse": "Rechtsfeit", "tekst": "indienen", '
        '"alternatieven": [{"klasse": "Rechtsbetrekking", "motivatie": "twijfel"}]}]}'
    )
    els = _parse_elementen(txt)
    assert len(els) == 1 and els[0]["klasse"] == "Rechtsfeit"
