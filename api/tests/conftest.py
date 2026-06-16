"""Test-fixtures + fakes voor LLM en MCP, zodat de hele engine zonder netwerk draait."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.llm.base import LLMResult  # noqa: E402

_LID_RE = re.compile(r"^Lid (\S+): (.*)$", re.MULTILINE)

ARTIKEL_DATA = {
    "citeertitel": "Testwet",
    "versiedatum": "2026-01-01",
    "bwbId": "BWBR9999999",
    "artikel": "1",
    "pad": "Hoofdstuk 1 > Artikel 1",
    "bronreferentie": "jci1.3:c:BWBR9999999&artikel=1",
    "leden": [{
        "lid": "1",
        "tekst": "De belastingplichtige dient aangifte te doen.",
        "bronreferentie": "jci1.3:c:BWBR9999999&artikel=1&lid=1&g=2026-01-01",
        "verwijzingen": [{
            "soort": "extref", "target": "jci1.3:c:BWBR0000001&artikel=2",
            "label": "artikel 2 van de Testdefinitiewet", "bwbIdDoel": "BWBR0000001", "extern": True,
        }],
    }],
}


class FakeWettenbank:
    def __init__(self, data: dict | None = None, fout: Exception | None = None) -> None:
        self.data = data or ARTIKEL_DATA
        self.fout = fout

    async def artikel(self, bwb_id: str, artikel: str, lid: str | None = None) -> dict:
        if self.fout:
            raise self.fout
        return self.data


class FakeLLM:
    """Produceert brongetrouwe output: citeert letterlijk de eerste lid-tekst uit de prompt."""

    def __init__(self, hallucineer: bool = False) -> None:
        self.hallucineer = hallucineer
        self.calls = 0

    async def complete(self, system: str, user: str, schema=None) -> LLMResult:
        self.calls += 1
        m = _LID_RE.search(user)
        lidnr, tekst = (m.group(1), m.group(2)) if m else ("1", "")
        citaat = "VERZONNEN TEKST DIE NIET IN DE WET STAAT" if self.hallucineer else tekst
        is_inventaris = "OPDRACHT (stap 1b" in user
        is_act3 = "OPDRACHT (activiteit 3)" in user or (
            "HERZIENE versie" in user and '"begrippen"' in user
        )
        if is_inventaris:
            # Fase 2a: één te-volgen definitie-verwijzing met een resolvebaar target.
            data = {"verwijzingen": [{
                "id": "v1", "bron_lid": f"lid {lidnr}", "soort": "extref", "functie": "definitie",
                "doel": {"label": "artikel 2 van de Testdefinitiewet",
                         "target": "jci1.3:c:BWBR0000001&artikel=2", "bwbId": "BWBR0000001"},
                "volgen": True,
            }]}
            return LLMResult(data=data, model="fake-model", provider="fake", output_strategie="prompt_and_parse")
        if is_act3:
            data = {
                "begrippen": [{"id": "b1", "naam": "belastingplichtige", "klasse": "Rechtssubject",
                               "definitie": "[interpretatie] degene die aangifte moet doen",
                               "vindplaats": f"lid {lidnr}"}],
                "afleidingsregels": [{"id": "r1", "naam": "aangifteplicht", "type": "beslisregel",
                                      "formulering": "ALS belastingplichtig DAN aangifteplicht",
                                      "vindplaats": f"lid {lidnr}"}],
                "validatiepunten": ["Open norm: 'aangifte' niet gedefinieerd in dit artikel."],
            }
        else:
            data = {
                "markeringen": [{"id": "m1", "formulering": citaat, "klasse": "Rechtssubject",
                                 "vindplaats": f"lid {lidnr}", "toelichting": "drager van de plicht"}],
                "verwijzingen": [{
                    "id": "v1", "bron_lid": f"lid {lidnr}", "soort": "extref", "functie": "definitie",
                    "doel": {"label": "artikel 2 van de Testdefinitiewet",
                             "target": "jci1.3:c:BWBR0000001&artikel=2", "bwbId": "BWBR0000001"},
                    "status": "opgehaald", "betekenis": "Definieert de belastingplichtige.",
                }],
                "samenhang": "De belastingplichtige is plichthebbende.",
                "type": "wet", "reikwijdte": "lid 1", "geraadpleegde": "",
            }
        return LLMResult(data=data, model="fake-model", provider="fake", output_strategie="prompt_and_parse")


@pytest.fixture
def settings(tmp_path) -> Settings:
    s = Settings()
    s.analyses_dir = tmp_path / "analyses"
    s.analyses_dir.mkdir(parents=True, exist_ok=True)
    s.max_autocorrectie = 0
    s.max_rondes = 6
    s.transient_max_retries = 0  # geen backoff-slaap in tests
    return s


@pytest.fixture
async def store(settings):
    from app import db
    from app.postgres_store import PostgresStore

    # In-memory SQLite (StaticPool → één gedeelde DB) met portable SQL — zelfde codepad als Postgres.
    db.init_engine("sqlite+aiosqlite://")
    await db.create_all()
    try:
        yield PostgresStore(settings)
    finally:
        await db.dispose_engine()


@pytest.fixture
async def engine(settings, store):
    from app.engine.orchestrator import WetsanalyseEngine
    return WetsanalyseEngine(settings, store, FakeLLM(), FakeWettenbank())
