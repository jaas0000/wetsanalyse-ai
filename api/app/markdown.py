"""Markdown-export uit rapport.json (de primaire bron). Bewust compact; de HTML-viewer
blijft de rijke presentatie. Spiegelt de sectie-indeling van render_rapport.py."""

from __future__ import annotations


def _tabel(headers: list[str], rijen: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for r in rijen:
        out.append("| " + " | ".join((c or "").replace("\n", " ").replace("|", "\\|") for c in r) + " |")
    return out


def rapport_naar_markdown(r: dict) -> str:
    L: list[str] = []
    L.append(f"# Wetsanalyse — {r.get('wet','')} artikel {r.get('artikel','')}")
    L.append("")

    L.append("## 0. Bron en afbakening")
    for label, key in [("Wet", "wet"), ("BWB-id", "bwbId"), ("Artikel", "artikel"),
                       ("Versiedatum", "versiedatum"), ("Bronreferentie", "bronreferentie"),
                       ("Pad", "pad"), ("Analysefocus", "analysefocus"),
                       ("Reikwijdte", "reikwijdte"), ("Geraadpleegd", "geraadpleegde")]:
        if (r.get(key) or "").strip():
            L.append(f"- **{label}:** {r[key]}")
    L.append("")

    L.append("## 1. Wettekst")
    for lid in r.get("leden", []):
        L.append(f"- **Lid {lid.get('lid','')}:** {lid.get('tekst','')}")
    L.append("")

    L.append("## 2. Markeringen en classificatie")
    L += _tabel(
        ["Id", "Formulering", "JAS-klasse", "Vindplaats", "Toelichting"],
        [[m.get("id", ""), m.get("formulering", ""), m.get("klasse", ""),
          m.get("vindplaats", ""), m.get("toelichting", "")] for m in r.get("markeringen", [])],
    )
    if (r.get("samenhang") or "").strip():
        L += ["", f"**Samenhang:** {r['samenhang']}"]
    L.append("")

    verwijzingen = r.get("verwijzingen", [])
    if verwijzingen:
        L.append("## 2b. Verwijzingen")
        rijen = []
        for v in verwijzingen:
            doel = v.get("doel") or {}
            doel_tekst = doel.get("label", "") or doel.get("target", "")
            if doel.get("target"):
                doel_tekst = f"[{doel_tekst}](https://wetten.overheid.nl/{doel['target']})"
            rijen.append([v.get("id", ""), v.get("functie", ""), doel_tekst,
                          v.get("bron_lid", ""), v.get("status", ""), v.get("betekenis", "")])
        L += _tabel(["Id", "Functie", "Doel", "Bron", "Status", "Betekenis"], rijen)
        L.append("")

    L.append("## 3. Begrippen en afleidingsregels")
    L.append("### Begrippen")
    L += _tabel(
        ["Id", "Naam", "Klasse", "Definitie", "Vindplaats"],
        [[b.get("id", ""), b.get("naam", ""), b.get("klasse", ""), b.get("definitie", ""),
          b.get("vindplaats", "")] for b in r.get("begrippen", [])],
    )
    L += ["", "### Afleidingsregels"]
    L += _tabel(
        ["Id", "Naam", "Type", "Formulering", "Vindplaats"],
        [[a.get("id", ""), a.get("naam", ""), a.get("type", ""), a.get("formulering", ""),
          a.get("vindplaats", "")] for a in r.get("afleidingsregels", [])],
    )
    L.append("")

    L.append("## 4. Reviewlog en aandachtspunten")
    rl = r.get("reviewlog", {})
    for act in ("activiteit2", "activiteit3"):
        sv = (rl.get(act, {}) or {}).get("samenvatting", "")
        if sv:
            L.append(f"- **Reviewlog {act}:** {sv}")
    if (r.get("aandachtspunten") or "").strip():
        L += ["", "### Aandachtspunten voor multidisciplinaire validatie", r["aandachtspunten"]]
    L.append("")
    return "\n".join(L)
