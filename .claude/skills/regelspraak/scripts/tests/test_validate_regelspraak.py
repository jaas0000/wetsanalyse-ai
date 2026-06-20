"""Tests voor validate_regelspraak.py — de mechanische pre-check vóór de review-server.

Stdlib-only (unittest + subprocess). De nadruk ligt op de gebruik-scan (stap `regels`):
een gedeclareerde parameter/objecttype dat door geen regel wordt aangeroepen, levert een
niet-blokkerende waarschuwing (exit 1) — het faalpatroon van de art. 9-output waar zeven
termijn-parameters ongebruikt bleven. Bestaande blokkerende checks (exit 2) blijven werken.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "validate_regelspraak.py"


def _regel(rid: str, naam: str, tekst: str) -> dict:
    return {
        "id": rid,
        "naam": naam,
        "soort": "kenmerktoekenning",
        "regelspraak_tekst": tekst,
        "herkomst": {"regel_id": "r1", "vindplaatsen": [{"bron_id": "br1", "lid": "1"}]},
    }


def _model(regels: list[dict], parameters: list[str], objecttypen: list[str]) -> dict:
    return {
        "werkgebied": {"naam": "Test"},
        "gegevensspraak_index": {
            "objecttypen": [{"naam": n} for n in objecttypen],
            "parameters": [{"naam": n} for n in parameters],
        },
        "regels": regels,
    }


def _run(model: dict) -> tuple[int, str]:
    with tempfile.TemporaryDirectory() as d:
        mp = Path(d) / "model.json"
        mp.write_text(json.dumps(model), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", str(mp), "--stap", "regels"],
            capture_output=True, text=True,
        )
        return proc.returncode, proc.stdout + proc.stderr


class GebruikScanTest(unittest.TestCase):
    def test_ongebruikte_parameter_geeft_waarschuwing_exit1(self):
        model = _model(
            regels=[_regel("rs1", "Iets", "Regel Iets\n  geldig altijd\n    Een belastingaanslag is invorderbaar.")],
            parameters=["de invorderingstermijn naheffingsaanslag"],
            objecttypen=["belastingaanslag"],
        )
        code, out = _run(model)
        self.assertEqual(code, 1)
        self.assertIn("de invorderingstermijn naheffingsaanslag", out)
        self.assertIn("door geen regel gebruikt", out)

    def test_gebruikte_parameter_geen_waarschuwing(self):
        tekst = (
            "Regel Termijn\n  geldig altijd\n    De vervaldatum van een belastingaanslag moet "
            "berekend worden als de dagtekening plus de invorderingstermijn naheffingsaanslag."
        )
        model = _model(
            regels=[_regel("rs1", "Termijn", tekst)],
            parameters=["de invorderingstermijn naheffingsaanslag"],
            objecttypen=["belastingaanslag"],
        )
        code, out = _run(model)
        self.assertEqual(code, 0)
        self.assertNotIn("door geen regel gebruikt", out)

    def test_ongebruikt_objecttype_geeft_waarschuwing(self):
        tekst = "Regel Iets\n  geldig altijd\n    Een belastingaanslag is invorderbaar."
        model = _model(
            regels=[_regel("rs1", "Iets", tekst)],
            parameters=[],
            objecttypen=["belastingaanslag", "aanslagbiljet"],
        )
        code, out = _run(model)
        self.assertEqual(code, 1)
        self.assertIn("Objecttype 'aanslagbiljet'", out)
        self.assertNotIn("Objecttype 'belastingaanslag'", out)

    def test_blokkerende_fout_blijft_exit2(self):
        # Ongeldige regel-soort = blokkerende fout; gaat vóór de niet-blokkerende usage-scan.
        regel = _regel("rs1", "Iets", "Regel Iets\n  geldig altijd\n    Een belastingaanslag is invorderbaar.")
        regel["soort"] = "onbestaande-soort"
        model = _model(regels=[regel], parameters=[], objecttypen=["belastingaanslag"])
        code, out = _run(model)
        self.assertEqual(code, 2)
        self.assertIn("Ongeldige regel-soort", out)


if __name__ == "__main__":
    unittest.main()
