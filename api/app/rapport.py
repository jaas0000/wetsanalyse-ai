"""Rapportbouw — hergebruikt de helpers uit build_rapport_json.py, in-proces.

We roepen het script NIET als subprocess of via main() aan: dat doet sys.exit() bij fouten en
zou de FastAPI-worker killen. We importeren de pure helpers en bouwen het rapport-dict zelf,
met exact dezelfde structuur als build_rapport_json.py produceert.
"""

from __future__ import annotations

from pathlib import Path

from .validation import _load_skill_module

_build = _load_skill_module("build_rapport_json")
laatste_ronde = _build.laatste_ronde
verzamel_rondes = _build.verzamel_rondes
bouw_reviewlog_rondes = _build.bouw_reviewlog_rondes
_laad_json = _build.laad_json


def bouw_rapport(
    werk: Path,
    reviewlog_act2: str = "",
    reviewlog_act3: str = "",
    aandachtspunten: str = "",
) -> dict:
    """Combineer de hoogste ronde van act-2 en act-3 tot één rapport-dict."""
    dir2 = werk / "activiteit-2"
    dir3 = werk / "activiteit-3"
    ronde2 = laatste_ronde(dir2)
    ronde3 = laatste_ronde(dir3)
    if ronde2 is None:
        raise ValueError(f"geen ronde gevonden in {dir2}")
    if ronde3 is None:
        raise ValueError(f"geen ronde gevonden in {dir3}")

    a2 = _laad_json(ronde2 / "analyse.json")
    a3 = _laad_json(ronde3 / "analyse.json")

    return {
        "wet": a2.get("wet", ""),
        "bwbId": a2.get("bwbId", ""),
        "artikel": a2.get("artikel", ""),
        "versiedatum": a2.get("versiedatum", ""),
        "bronreferentie": a2.get("bronreferentie", ""),
        "type": a2.get("type", ""),
        "pad": a2.get("pad", ""),
        "analysefocus": a2.get("analysefocus", ""),
        "reikwijdte": a2.get("reikwijdte", ""),
        "geraadpleegde": a2.get("geraadpleegde", ""),
        "leden": a2.get("leden", []),
        "markeringen": a2.get("markeringen", []),
        "samenhang": a2.get("samenhang", ""),
        "begrippen": a3.get("begrippen", []),
        "afleidingsregels": a3.get("afleidingsregels", []),
        "validatiepunten": a3.get("validatiepunten", []),
        "reviewlog": {
            "activiteit2": {
                "samenvatting": reviewlog_act2.strip(),
                "rondes": bouw_reviewlog_rondes(verzamel_rondes(dir2)),
            },
            "activiteit3": {
                "samenvatting": reviewlog_act3.strip(),
                "rondes": bouw_reviewlog_rondes(verzamel_rondes(dir3)),
            },
        },
        "aandachtspunten": aandachtspunten.strip(),
    }
