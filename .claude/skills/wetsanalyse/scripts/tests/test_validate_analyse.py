"""Tests voor validate_analyse.py — de mechanische pre-check vóór de review-server.

Exitcodes: 0 = schoon, 1 = waarschuwingen, 2 = blokkerende fouten / onleesbaar.
Stdlib-only (unittest + subprocess).

De analyse-eenheid is het werkgebied met meerdere bronnen: activiteit 2 draagt `bronnen[]`,
activiteit 3 is werkgebied-breed (gedeelde begrippen/afleidingsregels met `vindplaatsen`).
"""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "validate_analyse.py"

# Volledig valide activiteit-2-analyse (werkgebied met één bron): geen fouten én geen
# waarschuwingen → exit 0.
GELDIG_ACT2 = {
    "werkgebied": {"naam": "Testwerkgebied", "hoofdvraag": "test"},
    "analysefocus": "test",
    "bronnen": [
        {
            "bron_id": "br1",
            "label": "Wet X art. 1",
            "bwbId": "BWBR9999999",
            "artikel": "1",
            "bronreferentie": "jci1.3:c:BWBR9999999&artikel=1",
            "leden": [{"lid": "1", "tekst": "De belastingplichtige doet aangifte."}],
            "markeringen": [
                {
                    "id": "m1",
                    "bron_id": "br1",
                    "klasse": "Rechtssubject",
                    "formulering": "De belastingplichtige",
                    "vindplaats": "lid 1",
                }
            ],
            "verwijzingen": [],
        }
    ],
}


def _mark(data):
    """Snelkoppeling naar de eerste markering van de eerste bron."""
    return data["bronnen"][0]["markeringen"][0]


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
        data = copy.deepcopy(GELDIG_ACT2)
        _mark(data)["klasse"] = "VerzonnenKlasse"
        self.assertEqual(_run(data, "2"), 2)

    def test_dubbele_ids_over_bronnen_blokkeren(self):
        # Werkgebied-brede id-uniciteit: hetzelfde id in een tweede bron is fout.
        data = copy.deepcopy(GELDIG_ACT2)
        tweede = copy.deepcopy(data["bronnen"][0])
        tweede["bron_id"] = "br2"
        tweede["label"] = "Wet X art. 2"
        tweede["markeringen"][0]["bron_id"] = "br2"   # id blijft 'm1' → botsing
        data["bronnen"].append(tweede)
        self.assertEqual(_run(data, "2"), 2)

    def test_bron_id_mismatch_blokkeert(self):
        data = copy.deepcopy(GELDIG_ACT2)
        _mark(data)["bron_id"] = "br9"   # wijkt af van de bron 'br1'
        self.assertEqual(_run(data, "2"), 2)

    def test_ontbrekende_bronreferentie_blokkeert(self):
        data = copy.deepcopy(GELDIG_ACT2)
        data["bronnen"][0]["bronreferentie"] = ""
        self.assertEqual(_run(data, "2"), 2)

    def test_geen_bronnen_blokkeert(self):
        data = copy.deepcopy(GELDIG_ACT2)
        data["bronnen"] = []
        self.assertEqual(_run(data, "2"), 2)

    def test_malformed_json_blokkeert(self):
        self.assertEqual(_run("{ dit is geen geldige json", "2"), 2)

    def test_ontbrekend_bestand_blokkeert(self):
        res = subprocess.run(
            [sys.executable, str(SCRIPT), "--input", "/bestaat/echt/niet.json", "--activiteit", "2"],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(res.returncode, 2)

    def test_ellips_citaat_geen_waarschuwing(self):
        data = copy.deepcopy(GELDIG_ACT2)
        data["bronnen"][0]["leden"][0]["tekst"] = "De belastingschuldige kan niet meer dan een bankrekening bestemmen."
        _mark(data)["formulering"] = "De belastingschuldige kan ... een bankrekening bestemmen"
        self.assertEqual(_run(data, "2"), 0)

    def test_vierkante_haken_geen_waarschuwing(self):
        data = copy.deepcopy(GELDIG_ACT2)
        data["bronnen"][0]["leden"][0]["tekst"] = "De belastingschuldige bestemt een bankrekening."
        _mark(data)["formulering"] = "een [bankrekening]"
        self.assertEqual(_run(data, "2"), 0)

    def test_echt_niet_letterlijk_citaat_waarschuwt(self):
        data = copy.deepcopy(GELDIG_ACT2)
        _mark(data)["formulering"] = "de belastingbetaler verzint iets"
        self.assertEqual(_run(data, "2"), 1)

    def test_geldige_act3_exit_0(self):
        data = {
            "werkgebied": {"naam": "Testwerkgebied"},
            "bronnen": [{"bron_id": "br1", "label": "Wet X art. 1"}],
            "begrippen": [
                {"id": "b1", "naam": "belastingplichtige", "klasse": "Rechtssubject",
                 "definitie": "drager van rechten", "vindplaatsen": [{"bron_id": "br1", "lid": "1"}]}
            ],
            "afleidingsregels": [
                {"id": "r1", "naam": "regel", "type": "rekenregel", "formulering": "x is y",
                 "vindplaatsen": [{"bron_id": "br1", "lid": "1"}]}
            ],
        }
        self.assertEqual(_run(data, "3"), 0)

    def test_ongeldig_regeltype_act3_blokkeert(self):
        data = {
            "werkgebied": {"naam": "Testwerkgebied"},
            "bronnen": [{"bron_id": "br1", "label": "Wet X art. 1"}],
            "begrippen": [],
            "afleidingsregels": [
                {"id": "r1", "naam": "regel", "type": "onzinregel", "formulering": "ALS x DAN y",
                 "vindplaatsen": [{"bron_id": "br1", "lid": "1"}]}
            ],
        }
        self.assertEqual(_run(data, "3"), 2)


if __name__ == "__main__":
    unittest.main()
