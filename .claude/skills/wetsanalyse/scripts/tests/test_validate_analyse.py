"""Tests voor validate_analyse.py — de mechanische pre-check vóór de review-server.

Exitcodes: 0 = schoon, 1 = waarschuwingen, 2 = blokkerende fouten / onleesbaar.
Stdlib-only (unittest + subprocess).
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "validate_analyse.py"

# Volledig valide activiteit-2-analyse: geen fouten én geen waarschuwingen → exit 0.
GELDIG_ACT2 = {
    "bronreferentie": "jci1.3:c:BWBR9999999&artikel=1",
    "leden": [{"lid": "1", "tekst": "De belastingplichtige doet aangifte."}],
    "markeringen": [
        {
            "id": "m1",
            "klasse": "Rechtssubject",
            "formulering": "De belastingplichtige",
            "vindplaats": "lid 1",
        }
    ],
}


def _run(data_or_text, activiteit: str = "2") -> int:
    with tempfile.TemporaryDirectory() as d:
        pad = Path(d) / "analyse.json"
        if isinstance(data_or_text, str):
            pad.write_text(data_or_text, encoding="utf-8")
        else:
            pad.write_text(json.dumps(data_or_text), encoding="utf-8")
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", str(pad), "--activiteit", activiteit],
            text=True, capture_output=True, timeout=15,
        )
        return res.returncode


class ValidateAnalyseTest(unittest.TestCase):
    def test_geldige_analyse_exit_0(self):
        self.assertEqual(_run(GELDIG_ACT2, "2"), 0)

    def test_ongeldige_jas_klasse_blokkeert(self):
        data = json.loads(json.dumps(GELDIG_ACT2))
        data["markeringen"][0]["klasse"] = "VerzonnenKlasse"
        self.assertEqual(_run(data, "2"), 2)

    def test_dubbele_ids_blokkeren(self):
        data = json.loads(json.dumps(GELDIG_ACT2))
        data["markeringen"].append(dict(data["markeringen"][0]))  # id "m1" nogmaals
        self.assertEqual(_run(data, "2"), 2)

    def test_ontbrekende_bronreferentie_blokkeert(self):
        data = json.loads(json.dumps(GELDIG_ACT2))
        data["bronreferentie"] = ""
        self.assertEqual(_run(data, "2"), 2)

    def test_malformed_json_blokkeert(self):
        self.assertEqual(_run("{ dit is geen geldige json", "2"), 2)

    def test_ontbrekend_bestand_blokkeert(self):
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", "/bestaat/echt/niet.json", "--activiteit", "2"],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(res.returncode, 2)

    def test_ongeldig_regeltype_act3_blokkeert(self):
        data = {
            "bronreferentie": "jci1.3:c:BWBR9999999&artikel=1",
            "begrippen": [],
            "afleidingsregels": [
                {"id": "r1", "naam": "regel", "type": "onzinregel", "formulering": "ALS x DAN y", "vindplaats": "lid 1"}
            ],
        }
        self.assertEqual(_run(data, "3"), 2)


if __name__ == "__main__":
    unittest.main()
