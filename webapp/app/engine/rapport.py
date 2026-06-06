"""Rapport-generator voor wetsanalyse.

Genereert een Markdown-rapport op basis van de analyseresultaten,
volgens het sjabloon in .claude/skills/wetsanalyse/assets/analyserapport-sjabloon.md
"""

from app.models import Activiteit2Data, Activiteit3Data


def genereer_rapport(
    wet: str,
    bwb_id: str,
    artikel: str,
    versiedatum: str,
    bronreferentie: str,
    sectie: str | None,
    pad: str | None,
    activiteit_2: Activiteit2Data,
    activiteit_3: Activiteit3Data,
    review_feedback_2: str = "",
    review_feedback_3: str = "",
) -> str:
    """Genereer een Markdown-analyserapport."""

    lines: list[str] = []

    # ── Kop ──────────────────────────────────────────────────────────────────
    lid_str = f", lid {activiteit_2.leden[0].lid}" if len(activiteit_2.leden) == 1 else ""
    lines.append(f"# Wetsanalyse — {wet}, artikel {artikel}{lid_str}")
    lines.append("")
    lines.append(
        "> Analyse volgens de methode Wetsanalyse (Ausems, Bulles & Lokin), "
        "activiteit 2 + 3."
    )
    lines.append(
        "> Dit is een **concept-analyse als hulpmiddel**: bedoeld voor "
        "multidisciplinaire validatie (jurist, informatieanalist, ICT). "
        "Interpretatiekeuzes zijn als zodanig gemarkeerd."
    )
    lines.append("")

    # ── Sectie 0: Bron en afbakening ─────────────────────────────────────────
    lines.append("## 0. Bron en afbakening")
    lines.append("")
    lines.append(f"- **Wet / regeling:** {wet}")
    lines.append(f"- **BWB-id:** {bwb_id}")
    lines.append(f"- **Artikel(en):** {artikel}")
    if pad:
        lines.append(f"- **Pad:** {pad}")
    lines.append(f"- **Versie-/peildatum:** {versiedatum}")
    lines.append(f"- **Bronreferentie(s):** {bronreferentie}")
    lines.append("")

    # ── Sectie 1: Wettekst ───────────────────────────────────────────────────
    lines.append("## 1. Wettekst (letterlijk)")
    lines.append("")
    lines.append("> Letterlijk overgenomen uit de bron, lid voor lid. Geen parafrase.")
    lines.append("")

    for lid in activiteit_2.leden:
        lines.append(f"**Lid {lid.lid}.** {lid.tekst}")
        lines.append("")

    # ── Sectie 2: Activiteit 2 ───────────────────────────────────────────────
    lines.append("## 2. Activiteit 2 — Juridische structuur")
    lines.append("")
    lines.append("### 2a/2b — Markeringen en classificaties")
    lines.append("")
    lines.append(
        "| # | Formulering (letterlijk) | JAS-klasse | Vindplaats | Toelichting |"
    )
    lines.append(
        "| --- | --- | --- | --- | --- |"
    )

    for i, m in enumerate(activiteit_2.markeringen, 1):
        formulering = m.formulering.replace("|", "\\|")
        toelichting = m.toelichting.replace("|", "\\|")
        lines.append(
            f"| {i} | \"{formulering}\" | {m.klasse} | {m.vindplaats} | {toelichting} |"
        )

    lines.append("")

    if activiteit_2.samenhang:
        lines.append("### Samenhang rond de centrale klassen")
        lines.append("")
        lines.append(activiteit_2.samenhang)
        lines.append("")

    # ── Sectie 3: Activiteit 3 ───────────────────────────────────────────────
    lines.append("## 3. Activiteit 3 — Betekenis")
    lines.append("")

    # Begrippen
    lines.append("### 3a — Begrippen")
    lines.append("")
    lines.append(
        "| Begripsnaam | Klasse | Definitie | Voorbeeld | Kenmerken/relaties | Vindplaats | Twijfel |"
    )
    lines.append(
        "| --- | --- | --- | --- | --- | --- | --- |"
    )

    for b in activiteit_3.begrippen:
        definitie = b.definitie.replace("|", "\\|")
        voorbeeld = b.voorbeeld.replace("|", "\\|") if b.voorbeeld else ""
        kenmerken = b.kenmerken.replace("|", "\\|") if b.kenmerken else ""
        twijfel = b.twijfel.replace("|", "\\|") if b.twijfel else ""
        lines.append(
            f"| {b.naam} | {b.klasse} | {definitie} | {voorbeeld} | {kenmerken} | {b.vindplaats} | {twijfel} |"
        )

    lines.append("")

    # Afleidingsregels
    lines.append("### 3b — Afleidingsregels")
    lines.append("")

    for r in activiteit_3.afleidingsregels:
        lines.append(f"#### {r.naam} — {r.type}")
        lines.append("")
        lines.append(f"- **Uitvoervariabele:** {r.uitvoervariabele}")
        if r.invoervariabelen:
            lines.append(f"- **Invoervariabelen:** {r.invoervariabelen}")
        if r.parameters:
            lines.append(f"- **Parameters:** {r.parameters}")
        if r.voorwaarden:
            lines.append(f"- **Voorwaarden:** {r.voorwaarden}")
        if r.formulering:
            lines.append("- **Formulering:**")
            lines.append("  ```")
            lines.append(f"  {r.formulering}")
            lines.append("  ```")
        lines.append(f"- **Vindplaats / bron:** {r.vindplaats}")
        if r.twijfel:
            lines.append(f"- **Twijfel/aanname:** {r.twijfel}")
        lines.append("")

    # ── Sectie 4: Reviewlog en aandachtspunten ───────────────────────────────
    lines.append("## 4. Reviewlog en aandachtspunten voor validatie")
    lines.append("")

    lines.append("### Reviewlog")
    lines.append("")
    if review_feedback_2:
        lines.append(f"- **Na activiteit 2:** {review_feedback_2}")
    else:
        lines.append("- **Na activiteit 2:** akkoord zonder wijzigingen")
    if review_feedback_3:
        lines.append(f"- **Na activiteit 3:** {review_feedback_3}")
    else:
        lines.append("- **Na activiteit 3:** akkoord zonder wijzigingen")
    lines.append("")

    lines.append("### Aandachtspunten voor multidisciplinaire validatie")
    lines.append("")
    lines.append("> Wat een mens nog moet bevestigen voordat deze analyse de uitvoering in gaat.")
    lines.append("")

    if activiteit_3.validatiepunten:
        lines.append(activiteit_3.validatiepunten)
    else:
        lines.append("- Geen specifieke aandachtspunten geidentificeerd.")

    lines.append("")

    return "\n".join(lines)
