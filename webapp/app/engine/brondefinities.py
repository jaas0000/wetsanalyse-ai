"""Brondefinities-detectie in BWB-wetstekst.

Zoekt naar definitie-artikelen ("In deze wet wordt verstaan onder...")
en haalt de gedefinieerde termen op.
"""

import logging
import re

from app.engine.bwb_client import BwbClient

logger = logging.getLogger(__name__)

# Patronen die duiden op een definitie-artikel
DEFINITIE_PATRONEN = [
    r"In deze wet wordt verstaan onder",
    r"In deze regeling wordt verstaan onder",
    r"In dit hoofdstuk wordt verstaan onder",
    r"In deze afdeling wordt verstaan onder",
    r"In dit artikel wordt verstaan onder",
    r"Onder de naam .+ wordt verstaan",
]

# Patroon om individuele definities te parsen
# Bijv: "a. belastingplichtige: degene die belasting is verschuldigd;"
DEFINITIE_ITEM_RE = re.compile(
    r"^([a-z0-9][\w\s\-]*?)\s*:\s*(.+?)(?:\s*;\s*|\s*$)",
    re.MULTILINE,
)


async def vind_brondefinities(
    client: BwbClient,
    bwb_id: str,
    peildatum: str | None = None,
) -> dict[str, str]:
    """Zoek en haal brondefinities op uit een wet.

    Retourneert een dict: {term: definitie}
    """
    # Zoek naar "verstaan onder" in de wet
    try:
        resultaat = await client.zoekterm(
            bwb_id=bwb_id,
            zoekterm="verstaan onder",
            peildatum=peildatum,
            max_resultaten=20,
            includeer_tekst=True,
        )
    except Exception as e:
        logger.warning("Brondefinities zoeken mislukt: %s", e)
        return {}

    definities: dict[str, str] = {}

    for artikel_data in resultaat.get("artikelen", []):
        tekst = artikel_data.get("tekst", "")
        if not tekst:
            continue

        # Check of dit een definitieartikel is
        is_definitie = any(
            re.search(patroon, tekst, re.IGNORECASE)
            for patroon in DEFINITIE_PATRONEN
        )
        if not is_definitie:
            continue

        # Parse individuele definities
        for match in DEFINITIE_ITEM_RE.finditer(tekst):
            term = match.group(1).strip().rstrip(":")
            definitie = match.group(2).strip().rstrip(";").strip()
            if term and definitie:
                definities[term] = definitie

    logger.info(
        "Brondefinities gevonden voor %s: %d termen", bwb_id, len(definities)
    )
    return definities
