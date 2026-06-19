#!/usr/bin/env python3
"""Pre-tool-use hook: blokkeert schrijfacties naar beschermde analyse-bestanden.

Geldt voor beide sporen onder analyses/ (wetsanalyse → analyse.json; regelspraak → model.json):
  1. analyses/**/werk/**/feedback.json          — alleen de review-server schrijft dit; nooit de skill.
  2. analyses/**/werk/**/(analyse|model).json   — immutabel zodra het ronde-bestand bestaat.

Ontvangt via stdin: {"tool_name": "...", "tool_input": {"file_path": "..."}}
Exit 0: toegestaan; exit 2: geblokkeerd (stderr-bericht zichtbaar voor de skill/analist).

Configureer als PreToolUse hook in .claude/settings.json (matcher: "Write|Edit").
"""

import json
import re
import sys
from pathlib import Path

# Beide patronen matchen een willekeurige werk/-boom onder analyses/ — dus ook de geneste
# regelspraak-werkmap (analyses/<wg>/regelspraak/werk/...) naast de wetsanalyse-werkmap.
_FEEDBACK = re.compile(
    r"[/\\]analyses[/\\].+[/\\]werk[/\\].+[/\\]feedback\.json$",
    re.IGNORECASE,
)
_ANALYSE = re.compile(
    r"[/\\]analyses[/\\].+[/\\]werk[/\\].+[/\\](analyse|model)\.json$",
    re.IGNORECASE,
)


def main() -> None:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError, OSError):
        sys.exit(0)

    file_path = str((data.get("tool_input") or {}).get("file_path") or "")
    if not file_path:
        sys.exit(0)

    if _FEEDBACK.search(file_path):
        print(
            f"GEBLOKKEERD: {file_path}\n"
            "feedback.json wordt uitsluitend door de review-server geschreven. "
            "Pas de review aan via de webpagina.",
            file=sys.stderr,
        )
        sys.exit(2)

    if _ANALYSE.search(file_path):
        # Een bestaand ronde-resultaat (analyse.json/model.json) in werk/ is immutabel — ongeacht
        # grootte. Ook een leeg/partieel bestand (0 bytes) mag niet stilzwijgend worden
        # overschreven: de eerste write per ronde bestaat nog niet en is dus toegestaan, een
        # tweede write wordt geweigerd.
        if Path(file_path).is_file():
            print(
                f"GEBLOKKEERD: {file_path}\n"
                "Een bestaand ronde-resultaat in werk/ is immutabel. "
                "Schrijf naar een nieuwe ronde (ronde-N+1) in plaats van de bestaande te overschrijven.",
                file=sys.stderr,
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
