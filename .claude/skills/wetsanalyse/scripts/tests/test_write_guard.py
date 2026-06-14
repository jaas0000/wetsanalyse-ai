"""Tests voor write_guard.py — de PreToolUse-hook die beschermde analyse-bestanden afschermt.

Stdlib-only (unittest + subprocess). Draaien:
    python -m unittest discover -s .claude/skills/wetsanalyse/scripts/tests
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "write_guard.py"


def _run(file_path: str | None, *, raw_stdin: str | None = None) -> int:
    """Roep de hook aan met een tool_input.file_path (of rauwe stdin) en geef de exitcode terug."""
    if raw_stdin is None:
        payload = {"tool_name": "Write", "tool_input": {"file_path": file_path}}
        stdin = json.dumps(payload)
    else:
        stdin = raw_stdin
    res = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=stdin,
        text=True,
        capture_output=True,
        timeout=15,
    )
    return res.returncode


class WriteGuardTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.werk = self.root / "analyses" / "bwbr1-art1" / "werk" / "activiteit-2" / "ronde-1"
        self.werk.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def test_feedback_altijd_geblokkeerd(self):
        # feedback.json mag alleen de review-server schrijven → altijd exit 2.
        self.assertEqual(_run(str(self.werk / "feedback.json")), 2)

    def test_bestaande_analyse_geblokkeerd(self):
        pad = self.werk / "analyse.json"
        pad.write_text('{"markeringen": []}', encoding="utf-8")
        self.assertEqual(_run(str(pad)), 2)

    def test_lege_analyse_ook_geblokkeerd(self):
        # Regressie: een 0-byte analyse.json mag niet meer stilzwijgend overschreven worden.
        pad = self.werk / "analyse.json"
        pad.write_text("", encoding="utf-8")
        self.assertEqual(pad.stat().st_size, 0)
        self.assertEqual(_run(str(pad)), 2)

    def test_nieuwe_analyse_toegestaan(self):
        # Eerste write per ronde: bestand bestaat nog niet → toegestaan.
        self.assertEqual(_run(str(self.werk / "analyse.json")), 0)

    def test_niet_beschermd_pad_toegestaan(self):
        self.assertEqual(_run(str(self.root / "klad.txt")), 0)

    def test_analyse_buiten_werk_toegestaan(self):
        # Alleen analyse.json ónder werk/ is immutabel; daarbuiten niet.
        pad = self.root / "analyses" / "bwbr1-art1" / "analyse.json"
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text('{"x": 1}', encoding="utf-8")
        self.assertEqual(_run(str(pad)), 0)

    def test_ongeldige_stdin_faalt_open(self):
        # Geen bruikbare invoer → hook mag de tool niet blokkeren (exit 0).
        self.assertEqual(_run(None, raw_stdin="dit is geen json"), 0)
        self.assertEqual(_run(None, raw_stdin=""), 0)


if __name__ == "__main__":
    unittest.main()
