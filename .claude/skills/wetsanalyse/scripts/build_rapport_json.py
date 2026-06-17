#!/usr/bin/env python3
"""Bouw rapport.json uit de gevalideerde analyse-tussenresultaten.

Leest de hoogste ronde van activiteit-2 en activiteit-3 uit de werkmap en
combineert die tot één werkgebied-rapport.json — de primaire bron voor de
HTML-viewer en de Markdown-download.

De analyse-eenheid is het **werkgebied** (kennisdomein) met meerdere **bronnen**:
activiteit 2 levert per bron markeringen/verwijzingen (`bronnen[]`), activiteit 3
is werkgebied-breed (gedeelde `begrippen`/`afleidingsregels`).

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


# --- helpers ------------------------------------------------------------------

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

    bronnen = a2.get("bronnen", [])
    werkgebied = dict(a2.get("werkgebied") or {})
    # analysefocus voedt §0; act-3 mag een eigen werkgebied dragen, act-2 is leidend.
    werkgebied.setdefault("analysefocus", a2.get("analysefocus", ""))

    # Bouw werkgebied-rapport.json — bronnen[] (act-2) + gedeelde begrippen/regels (act-3).
    rapport = {
        # §0 werkgebied-metadata
        "werkgebied": werkgebied,

        # §1/§2 bronnen: per bron wettekst, markeringen, uitgaande verwijzingen, samenhang
        "bronnen": bronnen,

        # §3 gedeelde begrippen + regels (werkgebied-breed, uit act-3)
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
    print(f"Bron: activiteit-2 {ronde2.name}, activiteit-3 {ronde3.name} "
          f"({len(bronnen)} bron(nen))")
    if leeg:
        print(f"Let op: {leeg} vrij tekstveld(en) nog leeg "
              "(--reviewlog-act2, --reviewlog-act3, --aandachtspunten).")

    # Referentiële integriteit over de bronnen heen. Hier (na het mergen) is het volledige
    # beeld bekend; validate_analyse.py kan dit per los bestand niet over de activiteiten heen
    # checken. Twee controles:
    #   1. bron_verwijzing op een begrip/regel → een bestaande verwijzing-id in één van de bronnen;
    #   2. elke vindplaatsen.bron_id → een bestaande bron.
    bron_ids = {b.get("bron_id") for b in bronnen if b.get("bron_id")}
    verwijzing_ids = {
        v.get("id")
        for b in bronnen
        for v in (b.get("verwijzingen") or [])
        if v.get("id")
    }
    problemen: list[str] = []
    for groep, enkelvoud in (("begrippen", "begrip"), ("afleidingsregels", "afleidingsregel")):
        for item in rapport[groep]:
            iid = item.get("id", "?")
            bv = item.get("bron_verwijzing")
            if bv and bv not in verwijzing_ids:
                problemen.append(f"{enkelvoud} '{iid}' → onbekende bron_verwijzing '{bv}'")
            for vp in (item.get("vindplaatsen") or []):
                bid = vp.get("bron_id")
                if bid and bid not in bron_ids:
                    problemen.append(f"{enkelvoud} '{iid}' → onbekende vindplaats-bron_id '{bid}'")
    if problemen:
        print("Let op: dangling referenties (controleer act-2/act-3):")
        for p in problemen:
            print(f"  - {p}")


if __name__ == "__main__":
    main()
