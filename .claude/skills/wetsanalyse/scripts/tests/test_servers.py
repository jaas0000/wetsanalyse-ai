"""Tests voor de lokale review-/rapport-servers (stdlib-only).

Dekt de twee security-relevante eigenschappen die de servers garanderen:
  1. XSS-escaping: een veldwaarde met `</script>` kan de embed-script-tag niet sluiten.
  2. Veilige schrijfacties: POST /feedback schrijft de JSON naar het vastgelegde pad.
Plus de bestandsnaam-sanitizer (geen pad-scheidingstekens in de gegenereerde .md-naam).
"""

import http.client
import json
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import rapport_server  # noqa: E402
import review_server  # noqa: E402

PROBE = "ZZPROBE"  # uniek baken zodat de assertie los staat van template-inhoud


class XssEscapingTest(unittest.TestCase):
    def test_review_build_html_escapet_script(self):
        html = review_server.build_html(
            {"bronreferentie": "x", "markeringen": [{"id": "m1", "toelichting": PROBE + "</script>"}]},
            "2", 1, None,
        )
        self.assertNotIn(PROBE + "</script>", html)   # rauwe payload niet aanwezig
        self.assertIn(PROBE + "<\\/script>", html)    # wel de ge-escapete vorm

    def test_rapport_build_html_escapet_script(self):
        html = rapport_server.build_html({"aandachtspunten": PROBE + "</script>"})
        self.assertNotIn(PROBE + "</script>", html)
        self.assertIn(PROBE + "<\\/script>", html)


class BestandsnaamTest(unittest.TestCase):
    def test_md_bestandsnaam_bevat_geen_padscheiders(self):
        naam = rapport_server.md_bestandsnaam({"bwbId": "a/b\\c", "artikel": "1/2", "leden": []})
        self.assertNotIn("/", naam)
        self.assertNotIn("\\", naam)
        self.assertTrue(naam.startswith("analyserapport-"))
        self.assertTrue(naam.endswith(".md"))


class FeedbackWriteTest(unittest.TestCase):
    def test_post_feedback_schrijft_json(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "sub" / "feedback.json"  # niet-bestaande parent → moet aangemaakt worden
            handler = partial(review_server.ReviewHandler, html="<html>x</html>", feedback_out=out)
            srv = HTTPServer(("127.0.0.1", 0), handler)
            t = threading.Thread(target=srv.serve_forever, daemon=True)
            t.start()
            try:
                port = srv.server_address[1]
                payload = {"status": "akkoord", "activiteit": "2", "items": {}}
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                conn.request("POST", "/feedback", json.dumps(payload),
                             {"Content-Type": "application/json"})
                resp = conn.getresponse()
                self.assertEqual(resp.status, 200)
                self.assertTrue(json.loads(resp.read())["ok"])
                conn.close()
            finally:
                srv.shutdown()
                srv.server_close()
                t.join(timeout=5)

            self.assertTrue(out.exists())
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["status"], "akkoord")

    def test_post_naar_onbekend_pad_404(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "feedback.json"
            handler = partial(review_server.ReviewHandler, html="<html>x</html>", feedback_out=out)
            srv = HTTPServer(("127.0.0.1", 0), handler)
            t = threading.Thread(target=srv.serve_forever, daemon=True)
            t.start()
            try:
                port = srv.server_address[1]
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                conn.request("POST", "/iets-anders", "{}", {"Content-Type": "application/json"})
                self.assertEqual(conn.getresponse().status, 404)
                conn.close()
            finally:
                srv.shutdown()
                srv.server_close()
                t.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
