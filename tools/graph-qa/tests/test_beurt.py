"""De beurt-driver: de uitkomst wordt vastgelegd zonder dat er een browser bij nodig is.

Dit is de tweede helft van "de beurt is van de server". Fase 1 zorgde dat de run doorloopt als de
kijker weggaat; hier wordt bewezen dat het resultaat dan ook echt ergens landt.
"""
from __future__ import annotations

import asyncio
import functools
from typing import Any

import pytest

from agent.beurt import BeurtSchrijver, voer_beurt_uit
from agent.runs import Run
from agent.wetsanalyse_api import WetsanalyseApiFout
from tests.fakes import make_settings


def asyncio_test(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class NepApi:
    """Legt vast wát er geschreven zou worden, zonder netwerk."""

    def __init__(self, *, faalt: bool = False) -> None:
        self.faalt = faalt
        self.documenten: list[dict[str, Any]] = []
        self.element_puts: list[dict[str, Any]] = []
        self.berichten: list[tuple[str, dict[str, Any]]] = []
        self.gesloten = False

    async def maak_document(self, **kw: Any) -> str:
        self.documenten.append(kw)
        return "slug-1"

    async def zet_elementen(self, slug: str, **kw: Any) -> dict[str, Any]:
        self.element_puts.append({"slug": slug, **kw})
        return {}

    async def voeg_bericht_toe(self, gesprek_id: str, bericht: dict[str, Any]) -> dict[str, Any]:
        if self.faalt:
            raise WetsanalyseApiFout("POST /v1/gesprekken/… → 503")
        self.berichten.append((gesprek_id, bericht))
        return {}

    async def aclose(self) -> None:
        self.gesloten = True


@pytest.fixture
def api(monkeypatch):
    nep = NepApi()
    monkeypatch.setattr("agent.beurt.WetsanalyseApi", lambda *_a, **_k: nep)
    return nep


def _settings():
    return make_settings(wetsanalyse_api_url="http://api:3000", wetsanalyse_api_token="t", qa_api_token="q")


def _run(stop: bool = False) -> Run:
    run = Run(run_id="run-1", conversation_id="g1", vraag="v")
    run.stop_gevraagd = stop
    return run


async def _draai(events, *, settings=None, run=None, gesprek_id="g1", user_id="jurist"):
    async def stroom():
        for e in events:
            yield e

    return [
        ev async for ev in voer_beurt_uit(
            stroom(), settings=settings or _settings(), run=run or _run(),
            gesprek_id=gesprek_id, user_id=user_id,
        )
    ]


@asyncio_test
async def test_antwoordbeurt_wordt_vastgelegd(api):
    uit = await _draai([
        {"type": "status", "message": "Graaf bevragen"},
        {"type": "token", "content": "Het "},
        {"type": "token", "content": "antwoord."},
        {"type": "sources", "sources": [{"label": "IW art. 9", "uri": "x"}]},
        {"type": "done"},
    ])

    gesprek_id, bericht = api.berichten[0]
    assert gesprek_id == "g1"
    assert bericht["tekst"] == "Het antwoord."
    assert bericht["bronnen"] == [{"label": "IW art. 9", "uri": "x"}]
    assert bericht["denk"] == "· Graaf bevragen"
    # De sleutel die dubbel wegschrijven voorkomt als er twee tabbladen meekijken.
    assert bericht["run_id"] == "run-1"
    assert api.gesloten
    # `done` gaat er pas uit ná het wegschrijven: anders ziet een client die precies dan herlaadt
    # noch de run, noch het bericht.
    assert [e["type"] for e in uit][-2:] == ["opgeslagen", "done"]


@asyncio_test
async def test_annotatiebeurt_maakt_document_en_elementen(api):
    doel = {"bwbId": "BWBR0004770", "artikel": "9", "lid": "1", "citeertitel": "Invorderingswet 1990"}
    uit = await _draai([
        {"type": "doel", "doel": doel},
        {"type": "run", "run": {"model": "claude", "provider": "azure"}},
        {"type": "element", "element": {"id": "e1", "klasse": "Rechtssubject", "tekst": "de ontvanger"}},
        {"type": "suggestie", "suggestie": {"element_id": "m1", "aandacht": "geel", "motivatie": "let op"}},
        {"type": "ontbrekend", "items": [{"klasse": "Rechtsfeit"}]},
        {"type": "done"},
    ])

    assert api.documenten == [{
        "bwb_id": "BWBR0004770", "artikel": "9", "lid": "1", "citeertitel": "Invorderingswet 1990",
    }]
    put = api.element_puts[0]
    assert put["slug"] == "slug-1"
    assert put["elementen"][0]["tekst"] == "de ontvanger"
    assert put["suggesties"][0]["aandacht"] == "geel"
    assert put["run"] == {"model": "claude", "provider": "azure"}

    _, bericht = api.berichten[0]
    assert bericht["annotatie_slug"] == "slug-1"
    # Het label reist mee zodat de kaart zichzelf kan benoemen als het document later weg is.
    assert bericht["annotatie_titel"] == "Invorderingswet 1990 — art. 9 lid 1"
    assert bericht["ontbrekend"] == [{"klasse": "Rechtsfeit"}]

    opgeslagen = [e for e in uit if e["type"] == "opgeslagen"][0]
    assert opgeslagen["annotatie_slug"] == "slug-1"


@asyncio_test
async def test_zonder_elementen_geen_leeg_document(api):
    """`emit_node` is terminaal: een beurt die eerder eindigt heeft nul elementen. Zou het document
    al bij het `doel`-event ontstaan, dan bleef elk afgebroken pad als leeg skelet in de
    werkvoorraad van de jurist staan."""
    await _draai([
        {"type": "doel", "doel": {"bwbId": "BWBR0004770", "artikel": "9"}},
        {"type": "token", "content": "Ik vond geen JAS-elementen."},
        {"type": "done"},
    ])
    assert api.documenten == []
    _, bericht = api.berichten[0]
    assert bericht["tekst"] == "Ik vond geen JAS-elementen."


@asyncio_test
async def test_element_wordt_ontdubbeld(api):
    """De annoteerder ⇄ Critic-lus kan hetzelfde element opnieuw sturen; de laatste versie wint."""
    doel = {"bwbId": "B", "artikel": "9", "citeertitel": "Wet"}
    await _draai([
        {"type": "doel", "doel": doel},
        {"type": "element", "element": {"id": "e1", "klasse": "Rechtssubject", "tekst": "t"}},
        {"type": "element", "element": {"id": "e1", "klasse": "Rechtsobject", "tekst": "t"}},
        {"type": "done"},
    ])
    elementen = api.element_puts[0]["elementen"]
    assert len(elementen) == 1
    assert elementen[0]["klasse"] == "Rechtsobject"


@asyncio_test
async def test_stoppen_bewaart_wat_er_al_stond(api):
    """Weggooien wat de agent al schreef is niet wat 'stoppen' betekent."""
    uit = await _draai(
        [
            {"type": "token", "content": "Half "},
            {"type": "token", "content": "afgemaakt."},
            {"type": "done"},
        ],
        run=_run(stop=True),
    )
    _, bericht = api.berichten[0]
    assert bericht["tekst"].endswith("_(afgebroken)_")
    assert uit[-1]["type"] == "done"


@asyncio_test
async def test_zonder_api_blijft_het_een_doorgeefluik(api):
    """Geen api geconfigureerd → de werkplek schrijft weg, zoals vroeger. Lokaal draaien zonder api
    moet mogelijk blijven."""
    uit = await _draai(
        [{"type": "token", "content": "x"}, {"type": "done"}],
        settings=make_settings(),
    )
    assert api.berichten == []
    assert [e["type"] for e in uit] == ["token", "done"]


@asyncio_test
async def test_zonder_gebruiker_wordt_er_niets_geschreven(api):
    """De api scopet per gebruiker; zonder identiteit is er niemand om namens te handelen."""
    await _draai([{"type": "token", "content": "x"}, {"type": "done"}], user_id="")
    assert api.berichten == []


@asyncio_test
async def test_schrijffout_wordt_zichtbaar(monkeypatch):
    """Stil verliezen is het ergste wat hier kan gebeuren: dan ontdekt de jurist pas later dat het
    gesprek een gat heeft."""
    nep = NepApi(faalt=True)
    monkeypatch.setattr("agent.beurt.WetsanalyseApi", lambda *_a, **_k: nep)
    uit = await _draai([{"type": "token", "content": "x"}, {"type": "done"}])
    fouten = [e for e in uit if e["type"] == "error"]
    assert fouten and "niet opgeslagen" in fouten[0]["message"]
    assert uit[-1]["type"] == "done"
    assert nep.gesloten


def test_schrijver_houdt_denkproces_en_tekst_gescheiden():
    """Narratie is geen antwoord: `status`/`reason` vormen het denkproces, `token` het antwoord."""
    schrijver = BeurtSchrijver()
    for event in [
        {"type": "status", "message": "Stap één"},
        {"type": "reason", "content": "ik denk na"},
        {"type": "token", "content": "Antwoord"},
    ]:
        schrijver.verwerk(event)
    assert schrijver.tekst == "Antwoord"
    assert schrijver.denk == "· Stap éénik denk na"
