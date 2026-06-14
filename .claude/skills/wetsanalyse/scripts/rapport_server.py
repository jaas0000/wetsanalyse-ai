#!/usr/bin/env python3
"""Rapport-server voor de wetsanalyse-skill.

Serveert de rapport.html-viewer met het gegenereerde rapport.json en biedt twee
acties: het opslaan van bewerkingen op de vrije-tekstvelden (§4), en het
downloaden van het rapport als Markdown-bestand.

Geen dependencies buiten de standaardbibliotheek.

Gebruik:
    python rapport_server.py \\
        --input <rapport.json> \\
        [--port 3119] \\
        [--no-browser]
"""

import argparse
import io
import json
import os
import re
import signal as _signal
import subprocess
import sys
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "rapport.html"


# --- Markdown-generatie uit rapport.json -------------------------------------

def cel(tekst) -> str:
    if not tekst:
        return ""
    return str(tekst).replace("|", "\\|").replace("\n", "<br>").strip()


def rapport_naar_md(d: dict) -> str:
    regels: list[str] = []

    # Titel
    leden = d.get("leden", [])
    lid_aand = f" lid {leden[0]['lid']}" if len(leden) == 1 and leden[0].get("lid") else ""
    regels += [
        f"# Wetsanalyse — {d.get('wet', '')}, artikel {d.get('artikel', '')}{lid_aand}",
        "",
        "> Analyse volgens de methode Wetsanalyse (Ausems, Bulles & Lokin), activiteit 2 + 3.",
        "> Dit is een **concept-analyse als hulpmiddel**: bedoeld voor multidisciplinaire validatie",
        "> (jurist, informatieanalist, ICT). Interpretatiekeuzes zijn als zodanig gemarkeerd.",
        "",
    ]

    # §0 Bron en afbakening
    artikel = d.get("artikel", "")
    lid_str = f", lid {leden[0]['lid']}" if len(leden) == 1 and leden[0].get("lid") else ""
    regels += [
        "## 0. Bron en afbakening",
        "",
        f"- **Wet / regeling:** {d.get('wet', '')} ({d.get('type', '')})",
        f"- **BWB-id:** {d.get('bwbId', '')}",
        f"- **Artikel(en):** {artikel}{lid_str} — pad: {d.get('pad', '')}",
        f"- **Versie-/peildatum:** {d.get('versiedatum', '')}",
        f"- **Bronreferentie(s):** {d.get('bronreferentie', '')}",
        f"- **Analysefocus / hoofdvraag:** {d.get('analysefocus', '')}",
        f"- **Reikwijdte:** {d.get('reikwijdte', '')}",
        f"- **Geraadpleegde definitie-/aanpalende artikelen:** {d.get('geraadpleegde', '')}",
        "",
    ]

    # §1 Wettekst
    regels += [
        "## 1. Wettekst (letterlijk)",
        "",
        "> Letterlijk overgenomen uit de bron, lid voor lid. Geen parafrase.",
        "",
    ]
    for lid in leden:
        regels.append(f"**Lid {lid.get('lid', '?')}.** {lid.get('tekst', '')}")
        regels.append("")

    # §2 Markeringen
    regels += [
        "## 2. Activiteit 2 — Juridische structuur",
        "",
        "### 2a/2b — Markeringen en classificaties",
        "",
        "| # | Formulering (letterlijk) | JAS-klasse | Vindplaats | Toelichting (waarom deze klasse; evt. alternatief) |",
        "| --- | --- | --- | --- | --- |",
    ]
    for m in d.get("markeringen", []):
        regels.append(
            f"| {cel(m.get('id'))} | \"{cel(m.get('formulering'))}\" | "
            f"{cel(m.get('klasse'))} | {cel(m.get('vindplaats'))} | "
            f"{cel(m.get('toelichting'))} |"
        )
    regels += [
        "",
        "### Samenhang rond de centrale klassen",
        "",
        d.get("samenhang", ""),
        "",
    ]

    # §2b Verwijzingen
    verwijzingen = d.get("verwijzingen", [])
    if verwijzingen:
        regels += [
            "## 2b. Verwijzingen",
            "",
            "> Uitgaande verwijzingen van de bepaling, naar functie en scope-status.",
            "",
            "| # | Functie | Doel | Bron | Soort | Status | Betekenis |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for v in verwijzingen:
            doel = v.get("doel") or {}
            doel_tekst = doel.get("label") or doel.get("target") or ""
            if doel.get("target"):
                doel_tekst = f"[{doel_tekst}](https://wetten.overheid.nl/{doel['target']})"
            soort = v.get("soort", "")
            if v.get("extern"):
                soort = (soort + " · extern").strip(" ·")
            regels.append(
                f"| {cel(v.get('id'))} | {cel(v.get('functie'))} | {cel(doel_tekst)} | "
                f"{cel(v.get('bron_lid'))} | {cel(soort)} | {cel(v.get('status'))} | "
                f"{cel(v.get('betekenis'))} |"
            )
        regels.append("")

    # §3 Begrippen
    regels += [
        "## 3. Activiteit 3 — Betekenis",
        "",
        "### 3a — Begrippen",
        "",
        "| Begripsnaam | Klasse | Definitie (bron of [interpretatie]) | Voorbeeld | Kenmerken / relaties | Vindplaats | Twijfel/aanname |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for b in d.get("begrippen", []):
        regels.append(
            f"| {cel(b.get('naam'))} | {cel(b.get('klasse'))} | {cel(b.get('definitie'))} | "
            f"{cel(b.get('voorbeeld'))} | {cel(b.get('kenmerken'))} | "
            f"{cel(b.get('vindplaats'))} | {cel(b.get('twijfel'))} |"
        )
    regels += ["", "### 3b — Afleidingsregels", ""]
    for r in d.get("afleidingsregels", []):
        regels += [f"#### {r.get('naam', '')} — {r.get('type', '')}", ""]
        for lbl, key in [
            ("Uitvoervariabele", "uitvoervariabele"),
            ("Invoervariabelen", "invoervariabelen"),
            ("Parameters", "parameters"),
            ("Voorwaarden", "voorwaarden"),
        ]:
            if r.get(key):
                regels.append(f"- **{lbl}:** {r[key]}")
        regels += ["- **Formulering:**", "  ```"]
        for regel in str(r.get("formulering", "")).split("\n"):
            regels.append(f"  {regel}")
        regels += ["  ```"]
        if r.get("vindplaats"):
            regels.append(f"- **Vindplaats / bron:** {r['vindplaats']}")
        if r.get("twijfel"):
            regels.append(f"- **Twijfel/aanname:** {r['twijfel']}")
        regels.append("")

    # §4 Reviewlog + aandachtspunten
    rl = d.get("reviewlog", {})
    act2_samen = (rl.get("activiteit2") or {}).get("samenvatting", "")
    act3_samen = (rl.get("activiteit3") or {}).get("samenvatting", "")
    aandacht = d.get("aandachtspunten", "")

    regels += [
        "## 4. Reviewlog en aandachtspunten voor validatie",
        "",
        "### Reviewlog",
        "",
        f"- **Activiteit 2:** {act2_samen or '_TODO_'}",
        f"- **Activiteit 3:** {act3_samen or '_TODO_'}",
        "",
        "### Aandachtspunten voor multidisciplinaire validatie",
        "",
        aandacht or "_TODO_",
        "",
    ]

    return "\n".join(regels) + "\n"


def md_bestandsnaam(d: dict) -> str:
    bwb = re.sub(r"[^a-z0-9]", "", (d.get("bwbId") or "").lower())
    # Punt in het artikelnummer behouden (bv. "9.5"), zodat de bestandsnaam het
    # artikelnummer accuraat weergeeft en gelijkloopt met de analyse-mapnaam.
    art = re.sub(r"[^a-z0-9.]", "", str(d.get("artikel") or "").lower())
    leden = d.get("leden", [])
    lid = f"-lid{leden[0]['lid']}" if len(leden) == 1 and leden[0].get("lid") else ""
    slug = f"{bwb}-art{art}{lid}" if bwb and art else "analyserapport"
    return f"analyserapport-{slug}.md"


# --- HTTP server -------------------------------------------------------------

def build_html(rapport_data: dict) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    # Escape </script> zodat een veldwaarde de script-tag niet kan sluiten.
    data_json = json.dumps(rapport_data, ensure_ascii=False).replace("</script>", "<\\/script>")
    return template.replace("/*__EMBEDDED_DATA__*/", f"const EMBEDDED_DATA = {data_json};")


class RapportHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, html: str = "", rapport_pad: Path = None, **kwargs):
        self._html = html
        self._rapport_pad = rapport_pad
        super().__init__(*args, **kwargs)

    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, content_type: str, extra_headers: dict = None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, self._html.encode("utf-8"), "text/html; charset=utf-8")
        else:
            self._send(404, b"Not found", "text/plain; charset=utf-8")

    def do_POST(self):
        if self.path == "/schrijf-md":
            try:
                data = json.loads(self._rapport_pad.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as e:
                self._send(500, json.dumps({"ok": False, "error": str(e)}).encode("utf-8"),
                           "application/json; charset=utf-8")
                return
            md = rapport_naar_md(data)
            naam = md_bestandsnaam(data)
            md_pad = self._rapport_pad.parent / naam
            try:
                md_pad.write_text(md, encoding="utf-8")
            except OSError as e:
                self._send(500, json.dumps({"ok": False, "error": str(e)}).encode("utf-8"),
                           "application/json; charset=utf-8")
                return
            self._send(200, json.dumps({"ok": True, "pad": str(md_pad)}).encode("utf-8"),
                       "application/json; charset=utf-8")
            return

        if self.path != "/opslaan":
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return

        try:
            length = max(0, int(self.headers.get("Content-Length", 0)))
        except (TypeError, ValueError):
            length = 0
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b'{"ok":false,"error":"invalid json"}',
                       "application/json; charset=utf-8")
            return

        # Lees huidig rapport.json, pas alleen de drie bewerkbare velden aan.
        try:
            huidig = json.loads(self._rapport_pad.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            self._send(500, json.dumps({"ok": False, "error": str(e)}).encode("utf-8"),
                       "application/json; charset=utf-8")
            return

        if "reviewlog_act2" in body:
            huidig.setdefault("reviewlog", {}).setdefault("activiteit2", {})
            huidig["reviewlog"]["activiteit2"]["samenvatting"] = str(body["reviewlog_act2"])
        if "reviewlog_act3" in body:
            huidig.setdefault("reviewlog", {}).setdefault("activiteit3", {})
            huidig["reviewlog"]["activiteit3"]["samenvatting"] = str(body["reviewlog_act3"])
        if "aandachtspunten" in body:
            huidig["aandachtspunten"] = str(body["aandachtspunten"])

        # Atomisch schrijven via tijdelijk bestand.
        tmp_pad = self._rapport_pad.with_suffix(".json.tmp")
        try:
            tmp_pad.write_text(json.dumps(huidig, ensure_ascii=False, indent=2),
                               encoding="utf-8")
            os.replace(tmp_pad, self._rapport_pad)
        except OSError as e:
            self._send(500, json.dumps({"ok": False, "error": str(e)}).encode("utf-8"),
                       "application/json; charset=utf-8")
            return

        # Ververs de in-memory HTML met de nieuwe data.
        self.__class__._refresh_html(huidig)

        self._send(200, b'{"ok":true}', "application/json; charset=utf-8")

    @classmethod
    def _refresh_html(cls, data: dict):
        pass  # wordt overschreven door de factory-closure hieronder


def _kill_port(port: int) -> None:
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["powershell", "-Command",
                 f"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue"
                 " | Select-Object -ExpandProperty OwningProcess"],
                capture_output=True, text=True, timeout=10,
            )
            for pid in set(result.stdout.split()):
                if pid.strip() and pid.strip() != "0":
                    try:
                        os.kill(int(pid.strip()), _signal.SIGTERM)
                    except (ProcessLookupError, PermissionError, ValueError):
                        pass
        else:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True, timeout=5,
            )
            for pid in result.stdout.split():
                try:
                    os.kill(int(pid), _signal.SIGTERM)
                except (ProcessLookupError, PermissionError, ValueError):
                    pass
    except (FileNotFoundError, subprocess.SubprocessError):
        pass


def main():
    parser = argparse.ArgumentParser(description="Wetsanalyse rapport-server")
    parser.add_argument("--input", type=Path, required=True,
                        help="Pad naar rapport.json")
    parser.add_argument("--port", type=int, default=3119,
                        help="Serverpoort (default 3119)")
    parser.add_argument("--no-browser", action="store_true",
                        help="Open de browser niet automatisch")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"rapport.json niet gevonden: {args.input}", file=sys.stderr)
        sys.exit(1)
    if not TEMPLATE.exists():
        print(f"Template niet gevonden: {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    rapport_data = json.loads(args.input.read_text(encoding="utf-8"))

    # Mutable container zodat de handler de HTML kan verversen na /opslaan.
    html_container = [build_html(rapport_data)]

    class Handler(RapportHandler):
        @classmethod
        def _refresh_html(cls, data: dict):
            html_container[0] = build_html(data)

    # Overschrijf html per request zodat verversing na /opslaan zichtbaar is.
    original_init = Handler.__init__

    def patched_init(self, *a, **kw):
        kw["html"] = html_container[0]
        original_init(self, *a, **kw)

    Handler.__init__ = patched_init

    handler = partial(Handler, rapport_pad=args.input)

    _kill_port(args.port)
    try:
        server = HTTPServer(("127.0.0.1", args.port), handler)
        port = args.port
    except OSError:
        server = HTTPServer(("127.0.0.1", 0), handler)
        port = server.server_address[1]

    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    url = f"http://localhost:{port}"
    wet = rapport_data.get("wet", "")
    art = rapport_data.get("artikel", "")
    leden = rapport_data.get("leden", [])
    lid_str = f" lid {leden[0]['lid']}" if len(leden) == 1 and leden[0].get("lid") else ""
    print(f"\n  Wetsanalyse - rapport {wet}, artikel {art}{lid_str}")
    print(f"  -----------------------------------------")
    print(f"  URL:      {url}")
    print(f"  Rapport:  {args.input}")
    print(f"\n  Bekijk het rapport, pas §4-velden aan en klik Opslaan.")
    print(f"  Download de Markdown via de knop in de browser.")
    print(f"  Druk Ctrl+C om de server te stoppen.\n")

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server gestopt.")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
