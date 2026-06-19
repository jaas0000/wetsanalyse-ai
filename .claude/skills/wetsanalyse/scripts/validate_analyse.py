#!/usr/bin/env python3
"""Pre-check van analyse.json vóór de review-server.

Controleert mechanische fouten zodat de menselijke review zich op inhoud kan richten.
Draai dit script na het schrijven van analyse.json, vóórdat je review_server.py start.

De analyse-eenheid is het **werkgebied** met meerdere **bronnen**: activiteit 2 draagt een
`bronnen[]`-array (per bron leden/markeringen/verwijzingen); activiteit 3 is werkgebied-breed
(gedeelde begrippen/afleidingsregels met `vindplaatsen[{bron_id,lid}]`). Id's zijn
werkgebied-breed uniek.

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
import unicodedata
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

    Beide kanten worden eerst naar unicode-NFC genormaliseerd: zonder dat zouden een composé
    'é' (U+00E9) en een decomposé 'e'+combining-accent (U+0065 U+0301) — visueel identiek —
    als ongelijk gelden en een terecht citaat ten onrechte de toets laten falen.
    """
    formulering = unicodedata.normalize("NFC", formulering)
    brontekst = unicodedata.normalize("NFC", brontekst)
    schoon = _HAKEN.sub("", formulering)
    fragmenten = [f.strip() for f in _ELLIPS.split(schoon)]
    return all((not f) or (f in brontekst) for f in fragmenten)


def check_verwijzing_item(v: dict, geziene_ids: set[str], label: str) -> tuple[list[str], list[str]]:
    """Valideert één uitgaande verwijzing (structuur + enums). `geziene_ids` is werkgebied-breed."""
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    vid = v.get("id", "")
    if not vid:
        fouten.append(f"[{label}] Verwijzing heeft geen 'id'.")
    else:
        if vid in geziene_ids:
            fouten.append(f"Verwijzing-id '{vid}' komt meerdere keren voor (werkgebied-breed).")
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

    bronnen = data.get("bronnen") or []
    if not bronnen:
        fouten.append("Geen bronnen in 'bronnen' (een werkgebied heeft minstens één bron).")

    geziene_ids: set[str] = set()   # werkgebied-breed: markeringen én verwijzingen
    bron_ids: set[str] = set()
    heeft_delegatie_markering = False
    heeft_delegatie_verwijzing = False

    for bron in bronnen:
        bron_id = bron.get("bron_id", "")
        label = bron.get("label") or bron_id or "?"
        if not bron_id:
            fouten.append("Bron heeft geen 'bron_id'.")
        elif bron_id in bron_ids:
            fouten.append(f"bron_id '{bron_id}' komt meerdere keren voor.")
        else:
            bron_ids.add(bron_id)

        if not (bron.get("bronreferentie") or "").strip():
            fouten.append(f"[{label}] Veld 'bronreferentie' ontbreekt of is leeg.")

        leden_tekst = " ".join(
            (lid.get("tekst") or "") for lid in (bron.get("leden") or [])
        )

        markeringen = bron.get("markeringen") or []
        if not markeringen:
            waarschuwingen.append(f"[{label}] Geen markeringen gevonden.")

        for m in markeringen:
            mid = m.get("id", "")
            if not mid:
                fouten.append(f"[{label}] Markering heeft geen 'id' (verplicht voor feedback-koppeling).")
            else:
                if mid in geziene_ids:
                    fouten.append(f"Id '{mid}' komt meerdere keren voor (werkgebied-breed).")
                geziene_ids.add(mid)

            m_bron = m.get("bron_id", "")
            if m_bron and bron_id and m_bron != bron_id:
                fouten.append(
                    f"[{mid or '?'}] bron_id '{m_bron}' wijkt af van de bron '{bron_id}' "
                    "waarin de markering staat."
                )

            klasse = m.get("klasse", "")
            if not klasse:
                fouten.append(f"[{mid or '?'}] Veld 'klasse' ontbreekt of is leeg.")
            elif klasse not in GELDIGE_JAS_KLASSEN:
                fouten.append(
                    f"[{mid or '?'}] Ongeldige JAS-klasse: '{klasse}'. "
                    "Gebruik een van de 13 toegestane klassen."
                )
            elif klasse == DELEGATIE_KLASSE:
                heeft_delegatie_markering = True

            formulering = (m.get("formulering") or "").strip()
            if formulering and leden_tekst and not fragmenten_letterlijk(formulering, leden_tekst):
                kort = formulering[:60] + ("..." if len(formulering) > 60 else "")
                waarschuwingen.append(
                    f"[{mid}] Formulering lijkt geen letterlijk citaat uit de wettekst: '{kort}'"
                )

            if not (m.get("vindplaats") or "").strip():
                waarschuwingen.append(f"[{mid}] Veld 'vindplaats' ontbreekt of is leeg.")

        for v in (bron.get("verwijzingen") or []):
            v_bron = v.get("bron_id", "")
            if v_bron and bron_id and v_bron != bron_id:
                fouten.append(
                    f"[{v.get('id', '?')}] verwijzing-bron_id '{v_bron}' wijkt af van bron "
                    f"'{bron_id}'."
                )
            if v.get("functie") == "delegatie":
                heeft_delegatie_verwijzing = True
            v_fouten, v_waarschuwingen = check_verwijzing_item(v, geziene_ids, label)
            fouten.extend(v_fouten)
            waarschuwingen.extend(v_waarschuwingen)

    # Delegatie-koppeling: een delegatie-markering hoort ergens in het werkgebied een verwijzing
    # met functie 'delegatie' te hebben (de gedelegeerde regeling als uitgaande pointer of een
    # eigen bron).
    if heeft_delegatie_markering and not heeft_delegatie_verwijzing:
        waarschuwingen.append(
            "Er is een markering met klasse 'Delegatiebevoegdheid en delegatie-invulling' "
            "maar geen verwijzing met functie 'delegatie' — leg de gedelegeerde regeling "
            "vast als verwijzing of als eigen bron."
        )

    return fouten, waarschuwingen


def check_vindplaatsen(item: dict, iid: str, soort: str, bron_ids: set[str]) -> list[str]:
    """Waarschuw als 'vindplaatsen' ontbreekt/leeg is, items zonder bron_id bevat, of
    naar een bron_id wijst die niet in de bron-index staat."""
    waarschuwingen: list[str] = []
    vindplaatsen = item.get("vindplaatsen") or []
    if not vindplaatsen:
        waarschuwingen.append(f"[{iid or '?'}] {soort} heeft geen 'vindplaatsen'.")
    else:
        for vp in vindplaatsen:
            bid = (vp.get("bron_id") or "").strip()
            if not bid:
                waarschuwingen.append(f"[{iid or '?'}] vindplaats zonder 'bron_id'.")
            elif bron_ids and bid not in bron_ids:
                waarschuwingen.append(
                    f"[{iid or '?'}] vindplaats-bron_id '{bid}' staat niet in de bron-index."
                )
    return waarschuwingen


def check_activiteit_3(data: dict) -> tuple[list[str], list[str]]:
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    geziene_ids: set[str] = set()
    bron_ids = {b.get("bron_id") for b in (data.get("bronnen") or []) if b.get("bron_id")}

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

        waarschuwingen.extend(check_vindplaatsen(b, bid, "Begrip", bron_ids))

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

        waarschuwingen.extend(check_vindplaatsen(r, rid, "Afleidingsregel", bron_ids))

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
        context = f"{len(data.get('bronnen') or [])} bron(nen)"
    else:
        fouten, waarschuwingen = check_activiteit_3(data)
        context = (data.get("werkgebied") or {}).get("naam", "?")

    print(f"\n  Pre-check analyse.json - activiteit {args.activiteit}, werkgebied {context}")
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
