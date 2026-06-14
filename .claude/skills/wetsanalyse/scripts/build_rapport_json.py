#!/usr/bin/env python3
"""Bouw rapport.json uit de gevalideerde analyse-tussenresultaten.

Leest de hoogste ronde van activiteit-2 en activiteit-3 uit de werkmap en
combineert die tot één rapport.json — de primaire bron voor de HTML-viewer en
de Markdown-download.

De drie vrije-tekstvelden (reviewlog act. 2, reviewlog act. 3, aandachtspunten)
kunnen direct als vlag worden meegegeven zodat de skill ze in één aanroep invult.
Ontbreken ze, dan blijven ze leeg als startpunt dat de analist later bijwerkt.

Geen dependencies buiten de standaardbibliotheek.

Gebruik:
    python build_rapport_json.py \\
        --werk <pad/naar/analyse/werk> \\
        --out  <pad/naar/rapport.json> \\
        [--reviewlog-act2  "tekst..."] \\
        [--reviewlog-act3  "tekst..."] \\
        [--aandachtspunten "tekst..."]
"""

import argparse
import json
import re
import sys
from pathlib import Path


# --- helpers (gelijk aan render_rapport.py) -----------------------------------

def laatste_ronde(activiteit_dir: Path) -> Path | None:
    if not activiteit_dir.is_dir():
        return None
    rondes = []
    for p in activiteit_dir.glob("ronde-*"):
        m = re.fullmatch(r"ronde-(\d+)", p.name)
        if m and p.is_dir():
            rondes.append((int(m.group(1)), p))
    if not rondes:
        return None
    return max(rondes, key=lambda t: t[0])[1]


def laad_json(pad: Path) -> dict:
    try:
        return json.loads(pad.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        sys.exit(f"FOUT: kan {pad} niet lezen: {e}")


def verzamel_rondes(activiteit_dir: Path) -> list[tuple[int, dict | None]]:
    if not activiteit_dir.is_dir():
        return []
    out = []
    for p in sorted(
        activiteit_dir.glob("ronde-*"),
        key=lambda q: int(re.fullmatch(r"ronde-(\d+)", q.name).group(1))
        if re.fullmatch(r"ronde-(\d+)", q.name) else 0,
    ):
        m = re.fullmatch(r"ronde-(\d+)", p.name)
        if not (m and p.is_dir()):
            continue
        fb_pad = p / "feedback.json"
        fb = None
        if fb_pad.exists():
            try:
                fb = json.loads(fb_pad.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        out.append((int(m.group(1)), fb))
    return out


def bouw_reviewlog_rondes(rondes: list[tuple[int, dict | None]]) -> list[dict]:
    """Zet de ruw-feedback-data om naar een leesbare lijst voor de JSON."""
    result = []
    for n, fb in rondes:
        if fb is None:
            result.append({"ronde": n, "items": {}, "algemeen": ""})
        else:
            result.append({
                "ronde": n,
                "items": fb.get("items") or {},
                "algemeen": (fb.get("algemeen") or "").strip(),
                "status": fb.get("status", ""),
            })
    return result


# --- main ---------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--werk", required=True, type=Path,
                    help="werkmap met activiteit-2/ en activiteit-3/")
    ap.add_argument("--out", required=True, type=Path,
                    help="pad naar het te schrijven rapport.json")
    ap.add_argument("--reviewlog-act2", default="",
                    help="prozasamenvatting reviewlog activiteit 2")
    ap.add_argument("--reviewlog-act3", default="",
                    help="prozasamenvatting reviewlog activiteit 3")
    ap.add_argument("--aandachtspunten", default="",
                    help="gestructureerde aandachtspunten voor multidisciplinaire validatie")
    args = ap.parse_args()

    dir2 = args.werk / "activiteit-2"
    dir3 = args.werk / "activiteit-3"

    ronde2 = laatste_ronde(dir2)
    ronde3 = laatste_ronde(dir3)
    if ronde2 is None:
        sys.exit(f"FOUT: geen ronde gevonden in {dir2}")
    if ronde3 is None:
        sys.exit(f"FOUT: geen ronde gevonden in {dir3}")

    a2 = laad_json(ronde2 / "analyse.json")
    a3 = laad_json(ronde3 / "analyse.json")
    rondes2 = verzamel_rondes(dir2)
    rondes3 = verzamel_rondes(dir3)

    # Bouw rapport.json — root-niveau, consistent met analyse.json structuur.
    rapport = {
        # §0 metadata (uit act-2)
        "wet":           a2.get("wet", ""),
        "bwbId":         a2.get("bwbId", ""),
        "artikel":       a2.get("artikel", ""),
        "versiedatum":   a2.get("versiedatum", ""),
        "bronreferentie":a2.get("bronreferentie", ""),
        "type":          a2.get("type", ""),
        "pad":           a2.get("pad", ""),
        "analysefocus":  a2.get("analysefocus", ""),
        "reikwijdte":    a2.get("reikwijdte", ""),
        "geraadpleegde": a2.get("geraadpleegde", ""),

        # §1 wettekst (uit act-2)
        "leden":         a2.get("leden", []),

        # §2 markeringen + uitgaande verwijzingen (uit act-2)
        "markeringen":   a2.get("markeringen", []),
        "verwijzingen":  a2.get("verwijzingen", []),
        "samenhang":     a2.get("samenhang", ""),

        # §3 begrippen + regels (uit act-3)
        "begrippen":        a3.get("begrippen", []),
        "afleidingsregels": a3.get("afleidingsregels", []),
        "validatiepunten":  a3.get("validatiepunten", []),

        # §4 reviewlog + aandachtspunten (vrije tekstvelden + ruwe context)
        "reviewlog": {
            "activiteit2": {
                "samenvatting": args.reviewlog_act2.strip(),
                "rondes": bouw_reviewlog_rondes(rondes2),
            },
            "activiteit3": {
                "samenvatting": args.reviewlog_act3.strip(),
                "rondes": bouw_reviewlog_rondes(rondes3),
            },
        },
        "aandachtspunten": args.aandachtspunten.strip(),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rapport, ensure_ascii=False, indent=2),
                        encoding="utf-8")

    leeg = sum([
        1 if not rapport["reviewlog"]["activiteit2"]["samenvatting"] else 0,
        1 if not rapport["reviewlog"]["activiteit3"]["samenvatting"] else 0,
        1 if not rapport["aandachtspunten"] else 0,
    ])
    print(f"rapport.json geschreven naar {args.out}")
    print(f"Bron: activiteit-2 {ronde2.name}, activiteit-3 {ronde3.name}")
    if leeg:
        print(f"Let op: {leeg} vrij tekstveld(en) nog leeg "
              "(--reviewlog-act2, --reviewlog-act3, --aandachtspunten).")

    # Referentiële integriteit: elke bron_verwijzing op een begrip/regel moet naar een
    # bestaande verwijzing-id wijzen. Hier (na het mergen) is het volledige beeld bekend;
    # validate_analyse.py kan dit per los bestand niet over de activiteiten heen checken.
    verwijzing_ids = {v.get("id") for v in rapport["verwijzingen"] if v.get("id")}
    dangling = []
    for groep, enkelvoud in (("begrippen", "begrip"), ("afleidingsregels", "afleidingsregel")):
        for item in rapport[groep]:
            bv = item.get("bron_verwijzing")
            if bv and bv not in verwijzing_ids:
                dangling.append(f"{enkelvoud} '{item.get('id', '?')}' → bron_verwijzing '{bv}'")
    if dangling:
        print("Let op: bron_verwijzing zonder bijbehorende verwijzing (controleer act-2/act-3):")
        for d in dangling:
            print(f"  - {d}")


if __name__ == "__main__":
    main()
