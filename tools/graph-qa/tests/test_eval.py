"""PR 2.1: eval-scorers en een offline end-to-end eval-run."""
from __future__ import annotations

import asyncio

from eval import run_eval, scoring
from fakes import make_settings


def test_faithfulness_uit_grounding_event():
    assert scoring.faithfulness({"cited": 0, "unsupported": []}) == 1.0
    assert scoring.faithfulness({"cited": 4, "unsupported": []}) == 1.0
    assert scoring.faithfulness({"cited": 4, "unsupported": ["x"]}) == 0.75
    assert scoring.faithfulness({"cited": 1, "unsupported": ["x"]}) == 0.0


def test_source_recall():
    src = [{"uri": "https://ipalm.nl/bwb/BWBR0004770/artikel/9"}]
    assert scoring.source_recall(src, ["BWBR0004770"]) == 1.0
    assert scoring.source_recall(src, ["BWBR9999999"]) == 0.0
    assert scoring.source_recall([], []) == 1.0  # niets verwacht


def test_contains_en_refusal():
    assert scoring.contains_ok("De termijn is 14 dagen.", ["14 dagen"])
    assert not scoring.contains_ok("Geen termijn genoemd.", ["14 dagen"])
    assert scoring.refusal_ok([], should_refuse=True)
    assert not scoring.refusal_ok([{"uri": "x"}], should_refuse=True)
    assert scoring.refusal_ok([{"uri": "x"}], should_refuse=False)


def test_score_case_geslaagd():
    case = {"question": "q", "expected_sources": ["BWBR0004770"], "expected_contains": ["wet"]}
    res = scoring.score_case(
        case,
        answer="Dit is een wet.",
        sources=[{"uri": "https://ipalm.nl/bwb/BWBR0004770"}],
        grounding={"cited": 1, "unsupported": []},
    )
    assert res.passed is True


def test_score_case_zakt_op_ongegronde_citatie():
    res = scoring.score_case(
        {"question": "q"},
        answer="tekst",
        sources=[{"uri": "x"}],
        grounding={"cited": 2, "unsupported": ["BWBR9999999"]},
    )
    assert res.faithfulness < 1.0
    assert res.passed is False


def test_offline_eval_run_slaagt():
    cases, llm, graph = run_eval._offline_scenario()
    results = asyncio.run(run_eval.run_suite(cases, settings=make_settings(), llm=llm, graph=graph))
    assert len(results) == 1
    assert results[0].passed is True
    assert results[0].faithfulness == 1.0
