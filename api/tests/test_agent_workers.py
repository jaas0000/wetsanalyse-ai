"""Tests voor de agentische act-2-worker: de agent⇄tools-loop levert een bron-dict in dezelfde
vorm als de deterministische stap, en de verwijzing-fetch is begrensd.

FakeAgentLLM stuurt de executor rechtstreeks aan (tool-call haal_verwijzing → lever_analyse); geen
netwerk (FakeGraph uit test_graph_source)."""

from __future__ import annotations

from app.engine import agent_workers as aw
from app.llm.base import LLMResult

from test_graph_source import FakeGraph
from app import graph_source


class FakeAgentLLM:
    def __init__(self, payload, follow=None):
        self.payload = payload
        self.follow = follow  # (bwbId, artikel) om eerst op te halen, of None
        self.ruwe_tekst = ""

    async def run_tools(self, system, user, tools, execute, *, max_iters=12):
        if self.follow:
            self.laatste_ref = await execute("haal_verwijzing", {"bwbId": self.follow[0], "artikel": self.follow[1]})
        await execute("lever_analyse", self.payload)
        return LLMResult(data={}, model="m", provider="p", tokens_in=10, tokens_out=5, ruwe_tekst=self.ruwe_tekst)


class FallbackLLM:
    """Roept geen lever_analyse aan maar geeft losse JSON-tekst terug (fallback-pad)."""

    def __init__(self, ruwe_tekst):
        self.ruwe_tekst = ruwe_tekst

    async def run_tools(self, system, user, tools, execute, *, max_iters=12):
        return LLMResult(data={}, model="m", provider="p", tokens_in=1, tokens_out=1, ruwe_tekst=self.ruwe_tekst)


_PAYLOAD = {
    "markeringen": [
        {"id": "m1", "formulering": "De belastingplichtige", "klasse": "Rechtssubject", "vindplaats": "lid 1"},
    ],
    "verwijzingen": [{"id": "v1", "functie": "definitie", "doel": {"label": "artikel 2"}, "status": "gesignaleerd"}],
    "samenhang": "kort",
}


async def _basis():
    return await graph_source.haal_bron_basis(FakeGraph(), "br1", "BWBR9999999", "1")


async def test_worker_levert_bron_in_juiste_vorm():
    basis = await _basis()
    llm = FakeAgentLLM(_PAYLOAD)
    bron, prov = await aw.genereer_act2_bron_agentisch(
        llm, FakeGraph(), basis, ronde=1, analysefocus=None, max_verwijzing_fetches=6
    )
    # Brongetrouwe basis blijft (leden uit de graaf), LLM levert markeringen/verwijzingen.
    assert bron["bron_id"] == "br1" and bron["bwbId"] == "BWBR9999999"
    assert [ld["lid"] for ld in bron["leden"]] == ["1", "2"]
    assert bron["markeringen"][0]["klasse"] == "Rechtssubject"
    assert bron["markeringen"][0]["bron_id"] == "br1"      # bron_id opgelegd in de merge
    assert bron["verwijzingen"][0]["bron_id"] == "br1"
    assert "graph_verwijzingen" not in bron                # interne hulpsleutel lekt niet
    assert prov["activiteit"] == "2" and prov["tokens_in"] == 10


async def test_worker_volgt_verwijzing_via_graaf():
    basis = await _basis()
    g = FakeGraph()
    llm = FakeAgentLLM(_PAYLOAD, follow=("BWBR0000001", "2"))
    await aw.genereer_act2_bron_agentisch(llm, g, basis, 1, None, max_verwijzing_fetches=6)
    # De haal_verwijzing-tool bevroeg de graaf en gaf leden-tekst terug.
    assert "Lid 1:" in llm.laatste_ref


async def test_worker_fetch_limiet():
    basis = await _basis()
    llm = FakeAgentLLM(_PAYLOAD, follow=("BWBR0000001", "2"))
    await aw.genereer_act2_bron_agentisch(llm, FakeGraph(), basis, 1, None, max_verwijzing_fetches=0)
    # Bij cap 0 haalt de tool niets op maar meldt de limiet (geen crash).
    assert "limiet" in llm.laatste_ref.lower()


async def test_worker_fallback_op_losse_json():
    import json
    basis = await _basis()
    llm = FallbackLLM(json.dumps(_PAYLOAD))
    bron, _ = await aw.genereer_act2_bron_agentisch(llm, FakeGraph(), basis, 1, None, max_verwijzing_fetches=6)
    assert bron["markeringen"][0]["formulering"] == "De belastingplichtige"


async def test_worker_emit_stuurt_typed_events():
    basis = await _basis()
    llm = FakeAgentLLM(_PAYLOAD, follow=("BWBR0000001", "2"))
    events: list[tuple[str, dict]] = []

    async def emit(ev, data):
        events.append((ev, data))

    await aw.genereer_act2_bron_agentisch(
        llm, FakeGraph(), basis, 1, None, max_verwijzing_fetches=6, emit=emit
    )
    soorten = [e for e, _ in events]
    assert "status" in soorten          # agent-markeren gestart
    assert "reason" in soorten          # verwijzing volgen (tool-narratie)
    assert "element" in soorten         # per markering één element-event
