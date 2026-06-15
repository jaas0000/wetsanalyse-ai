#!/usr/bin/env python3
"""Pre-check van analyse.json vóór de review-server.

Controleert mechanische fouten zodat de menselijke review zich op inhoud kan richten.
Draai dit script na het schrijven van analyse.json, vóórdat je review_server.py start.

Exitcodes:
  0 — geen fouten of waarschuwingen
  1 — waarschuwingen (niet-blokkerend; toon als context bij de review)
  2 — fouten (blokkerend; herstel vóórdat je de review-server start)

Gebruik:
  python validate_analyse.py --input analyse.json --activiteit 2|3
"""

import argparse
import io
import json
import re
import sys
from pathlib import Path

GELDIGE_JAS_KLASSEN = {
    "Rechtssubject",
    "Rechtsobject",
    "Rechtsbetrekking",
    "Rechtsfeit",
    "Voorwaarde",
    "Afleidingsregel",
    "Variabele en variabelewaarde",
    "Parameter en parameterwaarde",
    "Operator",
    "Tijdsaanduiding",
    "Plaatsaanduiding",
    "Delegatiebevoegdheid en delegatie-invulling",
    "Brondefinitie",
}

GELDIGE_REGELTYPEN = {"beslisregel", "rekenregel", "specialisatieregel"}

GELDIGE_VERWIJZING_FUNCTIES = {
    "definitie", "schakel", "delegatie", "intra-artikel", "informatief",
}
GELDIGE_VERWIJZING_STATUS = {
    "opgehaald", "gevolgd", "gesignaleerd", "buiten-scope-diepte",
}
GELDIGE_VERWIJZING_SOORT = {"intref", "extref", "natuurlijk"}

DELEGATIE_KLASSE = "Delegatiebevoegdheid en delegatie-invulling"

# Een formulering markeert een niet altijd aaneengesloten stuk wettekst. De skill mag
# daarbij twee citeerconventies gebruiken die de letterlijke-substring-toets breken:
#   - beletselteken ('...' of '…') om weggelaten tussentekst te eliden;
#   - vierkante haken ([...]) om een verduidelijking/referent in te voegen.
# We toetsen daarom per losgesplitst fragment of het letterlijk in de wettekst staat,
# na verwijdering van de ingevoegde haken.
_ELLIPS = re.compile(r"\s*(?:\.\.\.|…)\s*")
_HAKEN = re.compile(r"\[[^\]]*\]")


def fragmenten_letterlijk(formulering: str, brontekst: str) -> bool:
    """True als elk (op beletselteken gesplitst) fragment letterlijk in de brontekst staat.

    Vierkante-haak-invoegingen worden eerst weggestript, zodat 'een [bankrekening]' op
    'een' wordt getoetst. Lege fragmenten (bv. door een eind-beletselteken) tellen niet mee.
    """
    schoon = _HAKEN.sub("", formulering)
    fragmenten = [f.strip() for f in _ELLIPS.split(schoon)]
    return all((not f) or (f in brontekst) for f in fragmenten)


def check_verwijzingen(data: dict) -> tuple[list[str], list[str]]:
    """Valideert de uitgaande-verwijzingen-array (structuur + enums).

    De cross-file koppeling (bron_verwijzing op een act-3-begrip → verwijzing-id in
    act-2) wordt niet hier maar in build_rapport_json.py gecheckt, waar beide
    activiteiten samenkomen.
    """
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    geziene_ids: set[str] = set()
    for v in (data.get("verwijzingen") or []):
        vid = v.get("id", "")
        if not vid:
            fouten.append("Verwijzing heeft geen 'id'.")
        else:
            if vid in geziene_ids:
                fouten.append(f"Verwijzing-id '{vid}' komt meerdere keren voor.")
            geziene_ids.add(vid)

        functie = v.get("functie", "")
        if not functie:
            fouten.append(f"[{vid or '?'}] Verwijzing mist 'functie'.")
        elif functie not in GELDIGE_VERWIJZING_FUNCTIES:
            fouten.append(
                f"[{vid or '?'}] Ongeldige verwijzing-functie: '{functie}'. "
                f"Gebruik: {', '.join(sorted(GELDIGE_VERWIJZING_FUNCTIES))}."
            )

        status = v.get("status", "")
        if not status:
            fouten.append(f"[{vid or '?'}] Verwijzing mist 'status'.")
        elif status not in GELDIGE_VERWIJZING_STATUS:
            fouten.append(
                f"[{vid or '?'}] Ongeldige verwijzing-status: '{status}'. "
                f"Gebruik: {', '.join(sorted(GELDIGE_VERWIJZING_STATUS))}."
            )

        soort = v.get("soort", "")
        if soort and soort not in GELDIGE_VERWIJZING_SOORT:
            waarschuwingen.append(
                f"[{vid or '?'}] Onbekende verwijzing-soort: '{soort}' "
                f"(verwacht: {', '.join(sorted(GELDIGE_VERWIJZING_SOORT))})."
            )

        doel = v.get("doel") or {}
        if not (doel.get("label") or "").strip():
            fouten.append(f"[{vid or '?'}] Verwijzing mist 'doel.label'.")

    return fouten, waarschuwingen


def check_activiteit_2(data: dict) -> tuple[list[str], list[str]]:
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    if not data.get("bronreferentie", "").strip():
        fouten.append("Topniveau-veld 'bronreferentie' ontbreekt of is leeg.")

    leden_tekst = " ".join(
        (lid.get("tekst") or "") for lid in (data.get("leden") or [])
    )

    markeringen = data.get("markeringen") or []
    if not markeringen:
        waarschuwingen.append("Geen markeringen gevonden in 'markeringen'.")

    geziene_ids: set[str] = set()
    for m in markeringen:
        mid = m.get("id", "")
        if not mid:
            fouten.append("Markering heeft geen 'id' (verplicht voor feedback-koppeling).")
        else:
            if mid in geziene_ids:
                fouten.append(f"Markering-id '{mid}' komt meerdere keren voor.")
            geziene_ids.add(mid)

        klasse = m.get("klasse", "")
        if not klasse:
            fouten.append(f"[{mid or '?'}] Veld 'klasse' ontbreekt of is leeg.")
        elif klasse not in GELDIGE_JAS_KLASSEN:
            fouten.append(
                f"[{mid or '?'}] Ongeldige JAS-klasse: '{klasse}'. "
                "Gebruik een van de 13 toegestane klassen."
            )

        formulering = (m.get("formulering") or "").strip()
        if formulering and leden_tekst and not fragmenten_letterlijk(formulering, leden_tekst):
            kort = formulering[:60] + ("..." if len(formulering) > 60 else "")
            waarschuwingen.append(
                f"[{mid}] Formulering lijkt geen letterlijk citaat uit de wettekst: '{kort}'"
            )

        if not (m.get("vindplaats") or "").strip():
            waarschuwingen.append(f"[{mid}] Veld 'vindplaats' ontbreekt of is leeg.")

    # Delegatie-koppeling: een delegatie-markering hoort een verwijzing met
    # functie 'delegatie' te hebben (de gedelegeerde regeling als uitgaande pointer).
    heeft_delegatie_markering = any(
        m.get("klasse") == DELEGATIE_KLASSE for m in markeringen
    )
    heeft_delegatie_verwijzing = any(
        v.get("functie") == "delegatie" for v in (data.get("verwijzingen") or [])
    )
    if heeft_delegatie_markering and not heeft_delegatie_verwijzing:
        waarschuwingen.append(
            "Er is een markering met klasse 'Delegatiebevoegdheid en delegatie-invulling' "
            "maar geen verwijzing met functie 'delegatie' — leg de gedelegeerde regeling "
            "vast als verwijzing."
        )

    v_fouten, v_waarschuwingen = check_verwijzingen(data)
    fouten.extend(v_fouten)
    waarschuwingen.extend(v_waarschuwingen)

    return fouten, waarschuwingen


def check_activiteit_3(data: dict) -> tuple[list[str], list[str]]:
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    geziene_ids: set[str] = set()

    for b in (data.get("begrippen") or []):
        bid = b.get("id", "")
        if not bid:
            fouten.append("Begrip heeft geen 'id' (verplicht voor feedback-koppeling).")
        else:
            if bid in geziene_ids:
                fouten.append(f"Id '{bid}' komt meerdere keren voor (begrip of afleidingsregel).")
            geziene_ids.add(bid)

        if not (b.get("naam") or "").strip():
            fouten.append(f"[{bid or '?'}] Begrip heeft geen 'naam'.")

        klasse = b.get("klasse", "")
        if not klasse:
            waarschuwingen.append(f"[{bid or '?'}] Veld 'klasse' ontbreekt of is leeg.")
        elif klasse not in GELDIGE_JAS_KLASSEN:
            waarschuwingen.append(
                f"[{bid or '?'}] Klasse op begrip is geen geldige JAS-klasse: '{klasse}'."
            )

        if not (b.get("definitie") or "").strip():
            waarschuwingen.append(f"[{bid or '?'}] Begrip heeft geen 'definitie'.")

        if not (b.get("vindplaats") or "").strip():
            waarschuwingen.append(f"[{bid or '?'}] Begrip heeft geen 'vindplaats'.")

        if "bron_verwijzing" in b and not (b.get("bron_verwijzing") or "").strip():
            waarschuwingen.append(
                f"[{bid or '?'}] Leeg 'bron_verwijzing' — laat het veld weg of vul een id in."
            )

    for r in (data.get("afleidingsregels") or []):
        rid = r.get("id", "")
        if not rid:
            fouten.append("Afleidingsregel heeft geen 'id' (verplicht voor feedback-koppeling).")
        else:
            if rid in geziene_ids:
                fouten.append(f"Id '{rid}' komt meerdere keren voor (begrip of afleidingsregel).")
            geziene_ids.add(rid)

        if not (r.get("naam") or "").strip():
            fouten.append(f"[{rid or '?'}] Afleidingsregel heeft geen 'naam'.")

        regeltype = r.get("type", "")
        if not regeltype:
            fouten.append(
                f"[{rid or '?'}] Veld 'type' ontbreekt. "
                "Gebruik: beslisregel, rekenregel of specialisatieregel."
            )
        elif regeltype not in GELDIGE_REGELTYPEN:
            fouten.append(
                f"[{rid or '?'}] Ongeldig regeltype: '{regeltype}'. "
                "Gebruik: beslisregel, rekenregel of specialisatieregel."
            )

        if not (r.get("formulering") or "").strip():
            fouten.append(f"[{rid}] Afleidingsregel heeft geen 'formulering'.")

        if not (r.get("vindplaats") or "").strip():
            waarschuwingen.append(f"[{rid}] Afleidingsregel heeft geen 'vindplaats'.")

    v_fouten, v_waarschuwingen = check_verwijzingen(data)
    fouten.extend(v_fouten)
    waarschuwingen.extend(v_waarschuwingen)

    return fouten, waarschuwingen


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Pre-check analyse.json voor review")
    parser.add_argument("--input", type=Path, required=True,
                        help="Pad naar analyse.json")
    parser.add_argument("--activiteit", choices=["2", "3"], required=True,
                        help="Activiteit 2 of 3")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"FOUT: bestand niet gevonden: {args.input}", file=sys.stderr)
        sys.exit(2)

    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FOUT: ongeldige JSON in {args.input}: {e}", file=sys.stderr)
        sys.exit(2)

    if args.activiteit == "2":
        fouten, waarschuwingen = check_activiteit_2(data)
    else:
        fouten, waarschuwingen = check_activiteit_3(data)

    artikel = data.get("artikel", "?")
    print(f"\n  Pre-check analyse.json - activiteit {args.activiteit}, artikel {artikel}")
    print(f"  {'-' * 52}")

    if not fouten and not waarschuwingen:
        print("  Geen fouten of waarschuwingen gevonden.\n")
        sys.exit(0)

    if fouten:
        print("\n  FOUTEN (blokkerend — herstel vóórdat je de review-server start):")
        for f in fouten:
            print(f"    FOUT  {f}")

    if waarschuwingen:
        print("\n  Waarschuwingen (niet-blokkerend — toon als context bij de review):")
        for w in waarschuwingen:
            print(f"    WAARSCHUWING  {w}")

    print()
    sys.exit(2 if fouten else 1)


if __name__ == "__main__":
    main()
