#!/usr/bin/env python3
"""Rapportgenerator voor de wetsanalyse-skill.

Rendert de deterministische delen van het eindrapport (secties 0-3 en het
reviewlog-skelet) rechtstreeks uit de gevalideerde `analyse.json`-bestanden van
de laatste reviewronde. Zo hoeft de skill de letterlijke wettekst, markeringen,
begrippen en afleidingsregels niet zelf over te typen — dat scheelt tokens en
garandeert dat sectie 1-3 brongetrouw met de bron overeenkomt.

Wat dit script NIET doet (dat blijft mensen-/skillwerk, want het is synthese):
- de §4-aandachtspunten voor multidisciplinaire validatie (de 5 categorieën);
- de prozasamenvatting "wat is per ronde gewijzigd" in de reviewlog.
Het script levert daarvoor een skelet met het ruwe materiaal (validatiepunten,
twijfelvelden, feedback per ronde) onder een `_TODO_`-markering, zodat de skill
het gericht afmaakt.

Geen dependencies buiten de standaardbibliotheek.

Gebruik:
    python render_rapport.py \
        --werk <pad/naar/analyse/werk> \
        --out  <pad/naar/analyserapport.md>

`--werk` is de werkmap met `activiteit-2/ronde-*/` en `activiteit-3/ronde-*/`.
Het script kiest per activiteit automatisch de hoogste ronde.
"""

import argparse
import json
import re
import sys
from pathlib import Path

TODO = "_TODO_"


# --- inlezen --------------------------------------------------------------

def laatste_ronde(activiteit_dir: Path) -> Path | None:
    """Geef de map `ronde-N` met de hoogste N binnen een activiteitmap."""
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
    """Geef per ronde (oplopend) de feedback.json, of None als die ontbreekt."""
    if not activiteit_dir.is_dir():
        return []
    out = []
    for p in sorted(activiteit_dir.glob("ronde-*"),
                    key=lambda q: int(re.fullmatch(r"ronde-(\d+)", q.name).group(1))
                    if re.fullmatch(r"ronde-(\d+)", q.name) else 0):
        m = re.fullmatch(r"ronde-(\d+)", p.name)
        if not (m and p.is_dir()):
            continue
        fb_pad = p / "feedback.json"
        fb = None
        if fb_pad.exists():
            try:
                fb = json.loads(fb_pad.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                fb = None
        out.append((int(m.group(1)), fb))
    return out


# --- helpers voor markdown ------------------------------------------------

def cel(tekst: str | None) -> str:
    """Maak tekst veilig voor een markdown-tabelcel (pipes/newlines)."""
    if not tekst:
        return ""
    return str(tekst).replace("|", "\\|").replace("\n", "<br>").strip()


def veld(data: dict, sleutel: str) -> str:
    """Haal een veld op of geef de TODO-markering als het ontbreekt/leeg is."""
    waarde = data.get(sleutel)
    if waarde is None or str(waarde).strip() == "":
        return TODO
    return str(waarde).strip()


# --- rendering ------------------------------------------------------------

def titel(a2: dict) -> str:
    wet = a2.get("wet", TODO)
    artikel = a2.get("artikel", TODO)
    leden = a2.get("leden", [])
    if len(leden) == 1 and leden[0].get("lid"):
        return f"# Wetsanalyse — {wet}, artikel {artikel} lid {leden[0]['lid']}"
    return f"# Wetsanalyse — {wet}, artikel {artikel}"


def sectie_0(a2: dict) -> list[str]:
    artikel = a2.get("artikel", TODO)
    leden = a2.get("leden", [])
    lid_aand = f", lid {leden[0]['lid']}" if len(leden) == 1 and leden[0].get("lid") else ""
    return [
        "## 0. Bron en afbakening",
        "",
        f"- **Wet / regeling:** {a2.get('wet', TODO)} ({veld(a2, 'type')})",
        f"- **BWB-id:** {a2.get('bwbId', TODO)}",
        f"- **Artikel(en):** {artikel}{lid_aand} — pad: {veld(a2, 'pad')}",
        f"- **Versie-/peildatum:** {a2.get('versiedatum', TODO)}",
        f"- **Bronreferentie(s):** {a2.get('bronreferentie', TODO)}",
        f"- **Analysefocus / hoofdvraag:** {veld(a2, 'analysefocus')}",
        f"- **Reikwijdte:** {veld(a2, 'reikwijdte')}",
        f"- **Geraadpleegde definitie-/aanpalende artikelen:** {veld(a2, 'geraadpleegde')}",
        "",
    ]


def sectie_1(a2: dict) -> list[str]:
    regels = [
        "## 1. Wettekst (letterlijk)",
        "",
        "> Letterlijk overgenomen uit de bron, lid voor lid. Geen parafrase.",
        "",
    ]
    leden = a2.get("leden", [])
    if not leden:
        regels.append(f"{TODO} (geen leden in analyse.json)")
        regels.append("")
        return regels
    for lid in leden:
        nr = lid.get("lid", "?")
        tekst = lid.get("tekst", TODO)
        regels.append(f"**Lid {nr}.** {tekst}")
        regels.append("")
    return regels


def sectie_2(a2: dict) -> list[str]:
    regels = [
        "## 2. Activiteit 2 — Juridische structuur",
        "",
        "### 2a/2b — Markeringen en classificaties",
        "",
        "| # | Formulering (letterlijk) | JAS-klasse | Vindplaats | Toelichting (waarom deze klasse; evt. alternatief) |",
        "| --- | --- | --- | --- | --- |",
    ]
    for m in a2.get("markeringen", []):
        regels.append(
            f"| {cel(m.get('id'))} | \"{cel(m.get('formulering'))}\" | "
            f"{cel(m.get('klasse'))} | {cel(m.get('vindplaats'))} | "
            f"{cel(m.get('toelichting'))} |"
        )
    regels += [
        "",
        "### Samenhang rond de centrale klassen",
        "",
        a2.get("samenhang", TODO),
        "",
    ]
    return regels


def sectie_3(a3: dict) -> list[str]:
    regels = [
        "## 3. Activiteit 3 — Betekenis",
        "",
        "### 3a — Begrippen",
        "",
        "| Begripsnaam | Klasse | Definitie (bron of [interpretatie]) | Voorbeeld | Kenmerken / relaties | Vindplaats | Twijfel/aanname |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for b in a3.get("begrippen", []):
        regels.append(
            f"| {cel(b.get('naam'))} | {cel(b.get('klasse'))} | {cel(b.get('definitie'))} | "
            f"{cel(b.get('voorbeeld'))} | {cel(b.get('kenmerken'))} | "
            f"{cel(b.get('vindplaats'))} | {cel(b.get('twijfel'))} |"
        )
    regels += ["", "### 3b — Afleidingsregels", ""]
    for r in a3.get("afleidingsregels", []):
        regels += [
            f"#### {r.get('naam', TODO)} — {r.get('type', TODO)}",
            "",
            f"- **Uitvoervariabele:** {r.get('uitvoervariabele', TODO)}",
            f"- **Invoervariabelen:** {r.get('invoervariabelen', TODO)}",
            f"- **Parameters:** {r.get('parameters', TODO)}",
            f"- **Voorwaarden:** {r.get('voorwaarden', TODO)}",
            "- **Formulering:**",
            "  ```",
        ]
        for fr in str(r.get("formulering", TODO)).split("\n"):
            regels.append(f"  {fr}")
        regels += [
            "  ```",
            f"- **Vindplaats / bron:** {r.get('vindplaats', TODO)}",
            f"- **Twijfel/aanname:** {r.get('twijfel', TODO)}",
            "",
        ]
    return regels


def reviewlog_regel(naam: str, rondes: list[tuple[int, dict | None]]) -> list[str]:
    if not rondes:
        return [f"- **{naam}:** {TODO} (geen rondes gevonden)"]
    laatste = rondes[-1][1]
    akkoord_schoon = (
        laatste
        and laatste.get("status") == "akkoord"
        and not laatste.get("items")
        and not (laatste.get("algemeen") or "").strip()
    )
    if len(rondes) == 1 and akkoord_schoon:
        return [f"- **{naam}:** 1 ronde — de analist ging in ronde 1 meteen akkoord, "
                "zonder per-item- of algemene feedback. Geen wijzigingen doorgevoerd."]
    # Meerdere rondes of feedback: skelet met ruw materiaal voor de skill.
    out = [f"- **{naam}:** {len(rondes)} ronde(s) — {TODO} vat per ronde samen wat op grond "
           "van de feedback is gewijzigd. Ruw materiaal per ronde:"]
    for n, fb in rondes:
        if fb is None:
            out.append(f"  - ronde {n}: (geen feedback.json)")
            continue
        items = fb.get("items") or {}
        algemeen = (fb.get("algemeen") or "").strip()
        if fb.get("status") == "akkoord" and not items and not algemeen:
            out.append(f"  - ronde {n}: akkoord zonder opmerkingen.")
            continue
        delen = []
        for k, v in items.items():
            delen.append(f"[{k}] {v}")
        if algemeen:
            delen.append(f"[algemeen] {algemeen}")
        out.append(f"  - ronde {n}: " + " · ".join(delen))
    return out


def sectie_4(a3: dict, rondes2, rondes3) -> list[str]:
    regels = ["## 4. Reviewlog en aandachtspunten voor validatie", "", "### Reviewlog", ""]
    regels += reviewlog_regel("Activiteit 2", rondes2)
    regels += reviewlog_regel("Activiteit 3", rondes3)
    regels += [
        "",
        "### Aandachtspunten voor multidisciplinaire validatie",
        "",
        f"> {TODO} — De skill vult dit gestructureerd in (interpretatiekeuzes / open normen /",
        "> openstaande delegaties / aannames / buiten scope), op basis van de twijfelvelden",
        "> hieronder en de validatiepunten uit activiteit 3. Verwijder dit blok na invullen.",
        "",
        "**Ruw materiaal — validatiepunten (activiteit 3):**",
        "",
    ]
    vp = a3.get("validatiepunten", TODO) or TODO
    if isinstance(vp, list):
        regels += [f"- {item}" for item in vp]
    else:
        regels.append(vp)
    regels += [
        "",
    ]
    return regels


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--werk", required=True, type=Path,
                    help="werkmap met activiteit-2/ en activiteit-3/")
    ap.add_argument("--out", required=True, type=Path, help="pad naar het rapport (.md)")
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

    regels: list[str] = [
        titel(a2),
        "",
        "> Analyse volgens de methode Wetsanalyse (Ausems, Bulles & Lokin), activiteit 2 + 3.",
        "> Dit is een **concept-analyse als hulpmiddel**: bedoeld voor multidisciplinaire validatie",
        "> (jurist, informatieanalist, ICT). Interpretatiekeuzes zijn als zodanig gemarkeerd.",
        "",
    ]
    regels += sectie_0(a2)
    regels += sectie_1(a2)
    regels += sectie_2(a2)
    regels += sectie_3(a3)
    regels += sectie_4(a3, rondes2, rondes3)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(regels) + "\n", encoding="utf-8")

    aantal_todo = ("\n".join(regels)).count(TODO)
    print(f"Rapport geschreven naar {args.out}")
    print(f"Bron: activiteit-2 {ronde2.name}, activiteit-3 {ronde3.name}")
    if aantal_todo:
        print(f"Let op: {aantal_todo}× {TODO} — vul deze handmatig/in de skill aan "
              "(sectie 0-metadata en de §4-aandachtspunten).")


if __name__ == "__main__":
    main()
