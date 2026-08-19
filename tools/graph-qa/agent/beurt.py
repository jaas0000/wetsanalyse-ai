"""
De beurt-driver: vangt de eventstroom op en legt de uitkomst vast.

Dit is het spiegelbeeld van wat de werkplek vroeger deed. Daar verzamelde `verstuur()` de events in
closure-variabelen en schreef ná de stream het document, de elementen en het chatbericht weg — met
als gevolg dat een gesloten tabblad al dat werk kostte. Diezelfde logica staat nu hier, achter de
run, waar geen browser bij nodig is.

Bewust **buiten** de LangGraph-code: de driver leest alleen de eventstroom van `answer_stream`, dus
`orchestrator.py` blijft ongemoeid. Dat scheelt risico op de plek waar het duurst is.

Twee volgorde-eisen die je niet mag omdraaien:

1. **`done` gaat er pas uit als er is weggeschreven.** Anders ziet een client die precies op dat
   moment herlaadt noch de lopende run, noch het bericht — en dan lijkt de beurt verdampt.
2. **Het document wordt pas aan het eind gemaakt.** `emit_node` is terminaal: vóór dat punt zijn er
   geen elementen. Een document dat al bij het `doel`-event ontstond, zou bij elke afgebroken run als
   leeg skelet in de werkvoorraad blijven staan.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from .config import Settings
from .wetsanalyse_api import WetsanalyseApi, WetsanalyseApiFout

logger = logging.getLogger("graph_qa.beurt")


def _titel(doel: dict[str, Any]) -> str:
    """Het leesbare label van de annotatie, zoals de werkplek het toont.

    Reist mee met het bericht zodat de kaart in het gesprek zichzelf kan benoemen als het document
    later verwijderd wordt — er is geen foreign key die dat afdwingt."""
    naam = doel.get("citeertitel") or doel.get("bwbId") or ""
    lid = doel.get("lid") or ""
    return f"{naam} — art. {doel.get('artikel', '')}" + (f" lid {lid}" if lid else "")


class BeurtSchrijver:
    """Verzamelt wat er in één beurt binnenkomt en legt het aan het eind vast."""

    def __init__(self) -> None:
        self.doel: dict[str, Any] | None = None
        self.elementen: list[dict[str, Any]] = []
        self.suggesties: list[dict[str, Any]] = []
        self.ontbrekend: list[dict[str, Any]] = []
        self.run: dict[str, Any] | None = None
        self.kandidaten: list[dict[str, Any]] = []
        self.tekst = ""
        self.denk = ""
        self.bronnen: list[dict[str, Any]] = []

    def verwerk(self, event: dict[str, Any]) -> None:
        """Eén event bijhouden. Dezelfde toewijzing als de handlers in de werkplek."""
        soort = event.get("type")
        if soort == "token":
            self.tekst += event.get("content", "")
        elif soort == "status":
            self.denk += ("\n" if self.denk else "") + "· " + event.get("message", "")
        elif soort == "reason":
            self.denk += event.get("content", "")
        elif soort == "sources":
            self.bronnen = event.get("sources") or []
        elif soort == "doel":
            self.doel = event.get("doel") or {}
        elif soort == "element":
            self._voeg_element_toe(event.get("element") or {})
        elif soort == "run":
            self.run = event.get("run") or {}
        elif soort == "ontbrekend":
            self.ontbrekend.extend(event.get("items") or [])
        elif soort == "suggestie":
            self.suggesties.append(event.get("suggestie") or {})
        elif soort == "kandidaten":
            self.kandidaten = event.get("kandidaten") or []

    def _voeg_element_toe(self, element: dict[str, Any]) -> None:
        """Ontdubbeld verzamelen: de annoteerder ⇄ Critic-lus kan hetzelfde element opnieuw sturen,
        en dan wint de laatste versie. Zelfde regel als `mergeVoorstellen` in de werkplek."""
        if not element:
            return
        sleutel = (element.get("id") or "", element.get("tekst") or "", element.get("lid") or "")
        for i, bestaand in enumerate(self.elementen):
            if (bestaand.get("id") or "", bestaand.get("tekst") or "", bestaand.get("lid") or "") == sleutel:
                self.elementen[i] = element
                return
        self.elementen.append(element)

    @property
    def is_annotatie(self) -> bool:
        return bool(self.doel and self.doel.get("bwbId") and self.elementen)


async def voer_beurt_uit(
    stroom: AsyncIterator[dict[str, Any]],
    *,
    settings: Settings,
    run,
    gesprek_id: str,
    user_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """Draai één beurt: stuur de events door, en leg aan het eind de uitkomst vast.

    `run` is het run-object uit het register; we lezen er het stopverzoek en het `run_id` uit.
    Schrijft graph-qa niet zelf weg (geen api geconfigureerd, of geen gesprek/gebruiker bekend), dan
    is dit puur een doorgeefluik en blijft de werkplek verantwoordelijk — precies het oude gedrag.
    """
    schrijver = BeurtSchrijver()
    afgebroken = False
    async for event in stroom:
        # Stoppen is gevraagd: geen nieuwe events meer doorgeven en afronden met wat er ligt. De
        # agent zelf draait nog even door in zijn executor-thread (de nodes zijn synchroon); dat is
        # onveranderd, en het is de reden dat "stoppen" tijd mag kosten.
        if run.stop_gevraagd:
            afgebroken = True
            break
        if event.get("type") == "done":
            # Vasthouden: `done` is voor de client het teken dat de beurt vastligt.
            break
        schrijver.verwerk(event)
        yield event

    mag_vastleggen = settings.legt_zelf_vast and bool(gesprek_id) and bool(user_id)
    if mag_vastleggen:
        async for na in _leg_vast(schrijver, settings=settings, run=run,
                                  gesprek_id=gesprek_id, afgebroken=afgebroken, user_id=user_id):
            yield na
    yield {"type": "done"}


async def _leg_vast(
    schrijver: BeurtSchrijver,
    *,
    settings: Settings,
    run,
    gesprek_id: str,
    afgebroken: bool,
    user_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """Schrijf document, elementen en het chatbericht weg; meld de uitkomst aan de client."""
    api = WetsanalyseApi(settings, user_id)
    try:
        bericht: dict[str, Any] = {"rol": "assistant", "run_id": run.run_id}
        slug = ""

        if schrijver.is_annotatie:
            doel = schrijver.doel or {}
            slug = await api.maak_document(
                bwb_id=str(doel.get("bwbId", "")),
                artikel=str(doel.get("artikel", "")),
                lid=str(doel.get("lid") or ""),
                citeertitel=str(doel.get("citeertitel") or ""),
            )
            await api.zet_elementen(
                slug,
                elementen=schrijver.elementen,
                suggesties=schrijver.suggesties,
                run=schrijver.run,
            )
            bericht |= {
                "annotatie_slug": slug,
                "annotatie_titel": _titel(doel),
                "ontbrekend": schrijver.ontbrekend,
                "denk": schrijver.denk,
            }
        else:
            tekst = schrijver.tekst.strip()
            if afgebroken:
                # Weggooien wat de agent al schreef is niet wat "stoppen" betekent.
                tekst = f"{tekst}\n\n_(afgebroken)_" if tekst else "_(afgebroken)_"
            bericht |= {
                "tekst": tekst or "(geen antwoord)",
                "denk": schrijver.denk,
                "bronnen": schrijver.bronnen,
            }

        await api.voeg_bericht_toe(gesprek_id, bericht)
        logger.info(
            "beurt vastgelegd",
            extra={"categorie": "functioneel", "run_id": run.run_id,
                   "chat_session_id": gesprek_id, "annotatie_slug": slug},
        )
        # De client hoeft de inhoud niet mee te krijgen: hij haalt het document bij de api op. Zo
        # blijft er één bron van waarheid en groeit het SSE-contract niet mee met het datamodel.
        yield {"type": "opgeslagen", "annotatie_slug": slug, "run_id": run.run_id}
    except (WetsanalyseApiFout, Exception):
        logger.exception(
            "beurt niet vastgelegd",
            extra={"categorie": "technisch", "run_id": run.run_id, "chat_session_id": gesprek_id},
        )
        # Zichtbaar falen: de jurist moet weten dat dit werk niet bewaard is, niet later ontdekken
        # dat het gesprek een gat heeft.
        yield {
            "type": "error",
            "message": "Het antwoord is gemaakt, maar niet opgeslagen. Probeer de vraag opnieuw.",
        }
    finally:
        await api.aclose()
