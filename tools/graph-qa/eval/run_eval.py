"""
Eval-harnas voor graph-qa.

Draait een gouden Q&A-set door de agent en scoort citaat-faithfulness, bron-recall,
contains- en refusal-checks. Twee modi:

  live (default) : echte providers (vereist een gevulde .env + bereikbare graaf).
      .venv/bin/python eval/run_eval.py

  offline        : gescripte fakes, geen netwerk/kosten — bewijst de harnas + scorers.
      .venv/bin/python eval/run_eval.py --offline

Exit-code ≠ 0 als niet alle cases slagen (CI-klaar).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from agent.agent import answer_stream  # noqa: E402
from agent.config import Settings  # noqa: E402
from eval.scoring import CaseResult, score_case  # noqa: E402

GOLDEN = Path(__file__).parent / "golden.jsonl"


def load_golden(path: Path = GOLDEN) -> list[dict[str, Any]]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            cases.append(json.loads(line))
    return cases


async def run_case(case: dict[str, Any], *, settings: Settings, llm=None, graph=None) -> CaseResult:
    parts: list[str] = []
    sources: list[dict[str, Any]] = []
    grounding: dict[str, Any] = {"grounded": True, "cited": 0, "unsupported": []}
    error: str | None = None

    async for ev in answer_stream(case["question"], settings=settings, llm=llm, graph=graph):
        t = ev.get("type")
        if t == "token":
            parts.append(ev["content"])
        elif t == "sources":
            sources = ev["sources"]
        elif t == "grounding":
            grounding = ev
        elif t == "error":
            error = ev["message"]

    return score_case(case, "".join(parts), sources, grounding, error)


async def run_suite(cases: list[dict[str, Any]], *, settings: Settings, llm=None, graph=None) -> list[CaseResult]:
    return [await run_case(c, settings=settings, llm=llm, graph=graph) for c in cases]


def print_report(results: list[CaseResult]) -> bool:
    print(f"\n{'faith':>6} {'recall':>6} {'cont':>4} {'refu':>4}  vraag")
    print("-" * 72)
    for r in results:
        flag = "OK " if r.passed else "XX "
        extra = f"  ! {r.error}" if r.error else ""
        print(
            f"{r.faithfulness:6.2f} {r.source_recall:6.2f} "
            f"{'ja' if r.contains_ok else 'nee':>4} {'ja' if r.refusal_ok else 'nee':>4}  "
            f"{flag}{r.question[:44]}{extra}"
        )
    passed = sum(r.passed for r in results)
    print("-" * 72)
    print(f"{passed}/{len(results)} geslaagd")
    return passed == len(results)


def _offline_scenario():
    """Eén gescripte case + fakes die de harnas end-to-end aantonen (geen netwerk)."""
    from tests.fakes import FakeGraph, FakeLLM, response, text_block, tool_block

    graph = FakeGraph(result='<https://ipalm.nl/bwb/BWBR0004770> bwb:citeertitel "Invorderingswet 1990" .')
    llm = FakeLLM([
        response([text_block("Ik raadpleeg list_regelingen.")], "end_turn"),          # plan-node (create)
        response([tool_block("t1", "list_regelingen", {})], "tool_use"),              # agent-turn 1 (stream)
        response([text_block("De Invorderingswet 1990 (BWBR0004770) staat in de graaf.")], "end_turn"),  # agent-turn 2
    ])
    case = {
        "question": "Welke regelingen zitten er in de kennisgraaf?",
        "expected_sources": ["BWBR0004770"],
        "expected_contains": ["Invorderingswet 1990"],
        "should_refuse": False,
    }
    return [case], llm, graph


def main() -> None:
    ap = argparse.ArgumentParser(description="graph-qa eval-harnas")
    ap.add_argument("--offline", action="store_true", help="draai met fakes (geen netwerk/kosten)")
    ap.add_argument("--golden", type=Path, default=GOLDEN, help="pad naar de golden set (jsonl)")
    args = ap.parse_args()

    if args.offline:
        cases, llm, graph = _offline_scenario()
        results = asyncio.run(run_suite(cases, settings=Settings(), llm=llm, graph=graph))
    else:
        try:
            from dotenv import load_dotenv

            load_dotenv(Path(__file__).parent.parent / ".env")
        except ImportError:
            pass
        cases = load_golden(args.golden)
        results = asyncio.run(run_suite(cases, settings=Settings.from_env()))

    ok = print_report(results)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
