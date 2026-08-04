"""End-to-end tests voor de agentische act-2-motor (WETSANALYSE_ACT2_ENGINE=agent).

Draait de volledige orchestratie (create → dekking-preflight → agent-generatie → harde gate →
review/rapport) met een FakeGraph (bron uit de graaf) en een scripted agent-LLM. Bewijst dat de
GraphDB-motor werkt én dat de dragende garanties (brongetrouwheid → fout, dekking-preflight) blijven.
"""

from __future__ import annotations

import re

import pytest

from app.contracts import BronInput, JobState, StartRequest
from app.engine.orchestrator import WetsanalyseEngine
from app.llm.base import LLMResult

from test_graph_source import FakeGraph
from conftest import FakeWettenbank

_LID = re.compile(r"^Lid (\S+): (.*)$", re.MULTILINE)


class AgentLLM:
    """Levert via `lever_analyse` één brongetrouwe markering in (citeert letterlijk het eerste lid
    uit de prompt), of een hallucinatie als `hallucineer=True`."""

    def __init__(self, hallucineer: bool = False) -> None:
        self.hallucineer = hallucineer
        self.calls = 0

    async def run_tools(self, system, user, tools, execute, *, max_iters: int = 12) -> LLMResult:
        self.calls += 1
        m = _LID.search(user)
        lid, tekst = (m.group(1), m.group(2)) if m else ("1", "")
        citaat = "VERZONNEN TEKST DIE NIET IN DE WET STAAT" if self.hallucineer else tekst
        payload = {
            "markeringen": [{"id": "m1", "formulering": citaat, "klasse": "Rechtssubject",
                             "vindplaats": f"lid {lid}", "toelichting": ""}],
            "verwijzingen": [],
            "samenhang": "kort",
        }
        await execute("lever_analyse", payload)
        return LLMResult(data={}, model="m", provider="p", tokens_in=10, tokens_out=5, ruwe_tekst="")

    async def complete(self, system, user, schema=None) -> LLMResult:  # revise-pad (niet in deze tests)
        return LLMResult(data={"bronnen": []}, model="m", provider="p", tokens_in=1, tokens_out=1)


def _agent_engine(settings, store, *, hallucineer=False, graph=None):
    settings.act2_engine = "agent"
    return WetsanalyseEngine(settings, store, AgentLLM(hallucineer), FakeWettenbank(), graph or FakeGraph())


def _req(review: bool):
    return StartRequest(bronnen=[BronInput(bwbId="BWBR9999999", artikel="1")], review=review)


async def test_agent_act2_zonder_review_naar_klaar(settings, store):
    engine = _agent_engine(settings, store)
    job = await engine.create_job(_req(review=False), "test")
    await engine.run_initial(job.id)

    geladen = await store.load_job(job.id)
    assert geladen.state == JobState.klaar
    analyse = await store.lees_analyse(job.id, "2", 1)
    bron = analyse["bronnen"][0]
    assert bron["bwbId"] == "BWBR9999999"
    assert bron["markeringen"][0]["klasse"] == "Rechtssubject"
    # Brongetrouwe leden komen uit de graaf (niet uit het LLM).
    assert bron["leden"][0]["tekst"].startswith("De belastingplichtige")
    rapport = await store.lees_rapport(job.id)
    assert rapport["bronnen"][0]["markeringen"]


async def test_agent_act2_met_review_pauzeert(settings, store):
    engine = _agent_engine(settings, store)
    job = await engine.create_job(_req(review=True), "test")
    await engine.run_initial(job.id)
    assert (await store.load_job(job.id)).state == JobState.wacht_review_act2


async def test_agent_brongetrouwheid_schending_naar_fout(settings, store):
    # Het model citeert tekst die niet in de graaf-leden staat → harde gate → fout (ook review:false).
    engine = _agent_engine(settings, store, hallucineer=True)
    job = await engine.create_job(_req(review=False), "test")
    await engine.run_initial(job.id)
    assert (await store.load_job(job.id)).state == JobState.fout


async def test_dekking_preflight_weigert_onbekende_bron(settings, store):
    engine = _agent_engine(settings, store, graph=FakeGraph(dekking_aantal=0))
    with pytest.raises(ValueError, match="kennisgraaf"):
        await engine.create_job(_req(review=False), "test")
