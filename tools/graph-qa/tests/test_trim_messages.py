"""F2: _trim_messages begrenst de historie naar de LLM met behoud van tool_use/tool_result-integriteit."""
from __future__ import annotations

from agent.orchestrator import _trim_messages


def _u(text: str) -> dict:
    return {"role": "user", "content": text}


def _a_tool(tid: str, naam: str = "get_lid") -> dict:
    return {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": naam, "input": {}}]}


def _r(tid: str, tekst: str) -> dict:
    return {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": tekst}]}


def _geen_orphan(msgs: list[dict]) -> bool:
    """Elke tool_result heeft een voorafgaand assistant-tool_use met hetzelfde id in de kept-lijst."""
    gezien: set[str] = set()
    for m in msgs:
        c = m.get("content")
        if m["role"] == "assistant" and isinstance(c, list):
            gezien |= {b["id"] for b in c if isinstance(b, dict) and b.get("type") == "tool_use"}
        if m["role"] == "user" and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") not in gezien:
                    return False
    return True


CONV = [
    _u("eerdere vraag 1"),
    _a_tool("t1"), _r("t1", "x" * 200),
    _u("eerdere vraag 2"),
    _a_tool("t2"), _r("t2", "y" * 200),
    _u("huidige vraag"),
]


def test_uit_bij_nul_of_leeg():
    assert _trim_messages(CONV, 0) == CONV
    assert _trim_messages([], 100) == []


def test_ruim_budget_ongewijzigd():
    assert _trim_messages(CONV, 10_000) == CONV


def test_klein_budget_respecteert_venster_en_invarianten():
    for budget in (50, 120, 250, 500, 900):
        kept = _trim_messages(CONV, budget)
        assert kept, "nooit leeg"
        assert kept[-1] == CONV[-1], "huidige vraag altijd behouden"
        assert kept[0]["role"] == "user" and isinstance(kept[0]["content"], str), "start = echte user-message"
        assert _geen_orphan(kept), "geen orphan tool_result"


def test_orphan_tool_result_vooraan_valt_weg():
    # Budget dat het venster midden in het t2-paar laat beginnen → de orphan tool_result (+ evt. losse
    # assistant) valt vooraan weg; de huidige vraag blijft.
    kept = _trim_messages(CONV, 210)
    assert _geen_orphan(kept)
    assert kept[0]["role"] == "user" and isinstance(kept[0]["content"], str)
    assert CONV[-1] in kept
