#!/usr/bin/env python3
"""Pre-check van een regelspraak-model.json vóór de review-server.

Controleert mechanische fouten zodat de menselijke review zich op inhoud kan richten.
Draai dit na het schrijven van model.json, vóórdat je review_server.py start.

Twee stappen:
  - `gegevensspraak`: het objectmodel (objecttypen, attributen, kenmerken, domeinen,
    parameters, feittypen/rollen, eenheidssystemen, dimensies, tijdlijnen, dagsoorten).
  - `regels`: de RegelSpraak-regels (+ een lichte gegevensspraak_index om naar te verwijzen).

Exitcodes:
  0 — geen fouten of waarschuwingen
  1 — waarschuwingen (niet-blokkerend; toon als context bij de review)
  2 — fouten (blokkerend; herstel vóórdat je de review-server start)

Gebruik:
  python validate_regelspraak.py --input model.json --stap gegevensspraak|regels
"""

import argparse
import io
import json
import re
import sys
from pathlib import Path

GELDIGE_KENMERK_SOORTEN = {"bijvoeglijk", "bezittelijk", "overig"}
GELDIGE_MULTIPLICITEIT = {"een", "meerdere"}
GELDIGE_REGELSOORTEN = {
    "gelijkstelling", "kenmerktoekenning", "consistentieregel", "initialisatie",
    "objectcreatie", "feitcreatie", "verdeling", "dagsoortdefinitie", "startpuntbepaling",
}

# Standaarddatatypes (RegelSpraak v2.3.0 §3.3). Een datatype mag ook een domeinnaam zijn;
# dat checken we apart tegen de gedeclareerde domeinen.
STANDAARD_DATATYPE_PREFIX = ("Numeriek", "Tekst", "Boolean", "Datum", "Percentage")

# Veel-gehallucineerde "operatoren" die niet in RegelSpraak bestaan. Puur een waarschuwing:
# de echte operatoren zijn plus / min / verminderd met / maal / gedeeld door / de som van / …
# (zie expressies-en-operatoren-referentie.md). Sleutel = verdacht patroon, waarde = hint.
VERDACHTE_PATRONEN = {
    r"\bvermeerderd met\b": "gebruik 'plus' (optellen bestaat niet als 'vermeerderd met')",
    r"\bopgeteld bij\b": "gebruik 'plus'",
    r"\bafgetrokken van\b": "gebruik 'min' of 'verminderd met'",
    r"\bvermenigvuldigd met\b": "gebruik 'maal'",
    r"\bgedeeld op\b": "gebruik 'gedeeld door'",
    r"(?<!de )\bsom van\b": "sommatie is 'de som van'",
}


def heeft_herkomst(item: dict) -> bool:
    h = item.get("herkomst") or {}
    if not isinstance(h, dict):
        return False
    heeft_ref = bool(h.get("begrip_ids") or h.get("regel_id") or h.get("bron_id"))
    heeft_vp = bool(h.get("vindplaatsen"))
    return heeft_ref or heeft_vp


def check_regelspraak_tekst(tekst: str, iid: str) -> list[str]:
    """Waarschuw bij verdachte, niet-bestaande taalpatronen in de RegelSpraak-tekst."""
    waarschuwingen: list[str] = []
    for patroon, hint in VERDACHTE_PATRONEN.items():
        if re.search(patroon, tekst, flags=re.IGNORECASE):
            waarschuwingen.append(
                f"[{iid or '?'}] Verdacht taalpatroon in regelspraak_tekst — {hint}."
            )
    return waarschuwingen


def check_gegevensspraak(data: dict) -> tuple[list[str], list[str]]:
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    gs = data.get("gegevensspraak") or {}
    if not gs:
        fouten.append("Geen 'gegevensspraak'-object gevonden.")
        return fouten, waarschuwingen

    geziene_ids: set[str] = set()
    domeinnamen = {d.get("naam") for d in (gs.get("domeinen") or []) if d.get("naam")}
    objecttype_namen = {o.get("naam") for o in (gs.get("objecttypen") or []) if o.get("naam")}

    def registreer_id(iid: str, soort: str, label: str) -> None:
        if not iid:
            fouten.append(f"[{label}] {soort} heeft geen 'id' (verplicht voor feedback-koppeling).")
        else:
            if iid in geziene_ids:
                fouten.append(f"Id '{iid}' komt meerdere keren voor (werkgebied-breed).")
            geziene_ids.add(iid)

    objecttypen = gs.get("objecttypen") or []
    if not objecttypen:
        waarschuwingen.append("Geen objecttypen in de GegevensSpraak.")

    for o in objecttypen:
        naam = o.get("naam") or "?"
        registreer_id(o.get("id", ""), "Objecttype", naam)
        if not (o.get("naam") or "").strip():
            fouten.append("Objecttype heeft geen 'naam'.")
        if not heeft_herkomst(o):
            waarschuwingen.append(f"[{naam}] Objecttype mist 'herkomst' (begrip-id + vindplaatsen).")
        if not (o.get("regelspraak_tekst") or "").strip():
            waarschuwingen.append(f"[{naam}] Objecttype mist 'regelspraak_tekst'.")

        for a in (o.get("attributen") or []):
            an = a.get("naam") or "?"
            dt = (a.get("datatype") or "").strip()
            if not dt:
                fouten.append(f"[{naam}.{an}] Attribuut mist 'datatype' (of domein).")
            elif not dt.startswith(STANDAARD_DATATYPE_PREFIX) and dt not in domeinnamen:
                waarschuwingen.append(
                    f"[{naam}.{an}] Datatype '{dt}' is geen standaarddatatype en geen "
                    "gedeclareerd domein."
                )

        for k in (o.get("kenmerken") or []):
            kn = k.get("naam") or "?"
            soort = (k.get("soort") or "").strip()
            if soort and soort not in GELDIGE_KENMERK_SOORTEN:
                fouten.append(
                    f"[{naam}.{kn}] Ongeldige kenmerk-soort: '{soort}'. "
                    f"Gebruik: {', '.join(sorted(GELDIGE_KENMERK_SOORTEN))}."
                )

    for d in (gs.get("domeinen") or []):
        if not (d.get("regelspraak_tekst") or "").strip():
            waarschuwingen.append(f"[{d.get('naam', '?')}] Domein mist 'regelspraak_tekst'.")

    for p in (gs.get("parameters") or []):
        pn = p.get("naam") or "?"
        registreer_id(p.get("id", ""), "Parameter", pn)
        if not (p.get("datatype") or "").strip():
            fouten.append(f"[{pn}] Parameter mist 'datatype' (of domein).")
        if not heeft_herkomst(p):
            waarschuwingen.append(f"[{pn}] Parameter mist 'herkomst'.")

    for ft in (gs.get("feittypen") or []):
        fn = ft.get("naam") or "?"
        registreer_id(ft.get("id", ""), "Feittype", fn)
        rollen = ft.get("rollen") or []
        if len(rollen) < 1:
            fouten.append(f"[{fn}] Feittype heeft geen rollen.")
        for rol in rollen:
            rn = rol.get("naam") or "?"
            mult = (rol.get("multipliciteit") or "").strip()
            if mult and mult not in GELDIGE_MULTIPLICITEIT:
                fouten.append(
                    f"[{fn}.{rn}] Ongeldige rol-multipliciteit: '{mult}'. "
                    f"Gebruik: {', '.join(sorted(GELDIGE_MULTIPLICITEIT))}."
                )
            ot = (rol.get("objecttype") or "").strip()
            if ot and objecttype_namen and ot not in objecttype_namen:
                waarschuwingen.append(
                    f"[{fn}.{rn}] Rol verwijst naar objecttype '{ot}' dat niet in de "
                    "GegevensSpraak is gedeclareerd."
                )

    return fouten, waarschuwingen


def check_regels(data: dict) -> tuple[list[str], list[str]]:
    fouten: list[str] = []
    waarschuwingen: list[str] = []

    regels = data.get("regels") or []
    if not regels:
        fouten.append("Geen 'regels' gevonden.")

    index = data.get("gegevensspraak_index") or {}
    bekende_objecttypen = {o.get("naam") for o in (index.get("objecttypen") or []) if o.get("naam")}
    bekende_parameters = {p.get("naam") for p in (index.get("parameters") or []) if p.get("naam")}
    if not index:
        waarschuwingen.append(
            "Geen 'gegevensspraak_index' — de regels kunnen niet tegen het objectmodel "
            "worden getoetst."
        )

    geziene_ids: set[str] = set()
    geziene_namen: set[str] = set()

    for r in regels:
        rid = r.get("id", "")
        naam = (r.get("naam") or "").strip()
        if not rid:
            fouten.append("Regel heeft geen 'id' (verplicht voor feedback-koppeling).")
        else:
            if rid in geziene_ids:
                fouten.append(f"Regel-id '{rid}' komt meerdere keren voor.")
            geziene_ids.add(rid)

        if not naam:
            fouten.append(f"[{rid or '?'}] Regel heeft geen 'naam'.")
        elif naam in geziene_namen:
            fouten.append(f"[{rid or '?'}] Regelnaam '{naam}' is niet uniek.")
        else:
            geziene_namen.add(naam)

        soort = (r.get("soort") or "").strip()
        if not soort:
            waarschuwingen.append(f"[{rid or '?'}] Regel mist 'soort' (resultaatactie).")
        elif soort not in GELDIGE_REGELSOORTEN:
            fouten.append(
                f"[{rid or '?'}] Ongeldige regel-soort: '{soort}'. "
                f"Gebruik een van: {', '.join(sorted(GELDIGE_REGELSOORTEN))}."
            )

        tekst = (r.get("regelspraak_tekst") or "").strip()
        if not tekst:
            fouten.append(f"[{rid or '?'}] Regel mist 'regelspraak_tekst'.")
        else:
            if not re.search(r"^\s*Regel\b", tekst):
                waarschuwingen.append(f"[{rid or '?'}] regelspraak_tekst begint niet met 'Regel'.")
            if not re.search(r"\bgeldig\b", tekst):
                waarschuwingen.append(
                    f"[{rid or '?'}] regelspraak_tekst mist een 'geldig'-regelversie."
                )
            waarschuwingen.extend(check_regelspraak_tekst(tekst, rid))

        if not heeft_herkomst(r):
            waarschuwingen.append(f"[{rid or '?'}] Regel mist 'herkomst' (regel-id + vindplaatsen).")

    return fouten, waarschuwingen


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Pre-check regelspraak-model.json voor review")
    parser.add_argument("--input", type=Path, required=True, help="Pad naar model.json")
    parser.add_argument("--stap", choices=["gegevensspraak", "regels"], required=True,
                        help="Welke stap wordt gevalideerd")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"FOUT: bestand niet gevonden: {args.input}", file=sys.stderr)
        sys.exit(2)

    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FOUT: ongeldige JSON in {args.input}: {e}", file=sys.stderr)
        sys.exit(2)

    if args.stap == "gegevensspraak":
        fouten, waarschuwingen = check_gegevensspraak(data)
        gs = data.get("gegevensspraak") or {}
        context = f"{len(gs.get('objecttypen') or [])} objecttype(n)"
    else:
        fouten, waarschuwingen = check_regels(data)
        context = f"{len(data.get('regels') or [])} regel(s)"

    werkgebied = (data.get("werkgebied") or {}).get("naam", "?")
    print(f"\n  Pre-check model.json - stap {args.stap}, werkgebied {werkgebied} ({context})")
    print(f"  {'-' * 56}")

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
