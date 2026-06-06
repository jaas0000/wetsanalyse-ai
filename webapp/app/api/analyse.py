"""API routes voor analyse-operaties."""

import copy
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError

from app.engine.bwb_client import get_client, McpError
from app.engine.llm import LlmError, run_classificatie, run_betekenis
from app.engine.rapport import genereer_rapport
from app.engine.analyse_store import save_analyse, load_analyse, list_analyses, delete_analyse
from app.engine.model_helpers import reconstruct_activiteit_2, reconstruct_activiteit_3
from app.models import (
    AnalyseStart,
    ReviewSubmit,
)
from app.auth import get_current_user, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analyse"])


def _safe_dump(obj) -> dict:
    """Veilig serialiseer een Pydantic model naar een platte dict.

    Gebruikt model_dump(mode='json') en converteert vervolgens alle
    overgebleven Pydantic objecten recursief naar dicts. Dit voorkomt
    'Object of type X is not JSON serializable' errors.
    """
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if hasattr(obj, "model_dump"):
        obj = obj.model_dump(mode="json")
    if isinstance(obj, dict):
        return {k: _safe_dump(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe_dump(v) for v in obj]
    return obj


@router.post("/analyse")
async def start_analyse(
    req: AnalyseStart,
    current_user: User = Depends(get_current_user),
):
    """Start een nieuwe wetsanalyse.

    Doorloopt: ophalen → classificatie → review checkpoint 2.
    """
    analyse_id = uuid.uuid4().hex

    try:
        # Stap 1: Zoek de wet
        client = await get_client()
        zoek_result = await client.zoek(titel=req.wet, regelingsoort="wet", max_resultaten=10)

        if not zoek_result.regelingen:
            # Fallback: zoek zonder type-filter
            zoek_result = await client.zoek(titel=req.wet, max_resultaten=10)

        if not zoek_result.regelingen:
            raise HTTPException(404, f"Geen wet gevonden voor: {req.wet}")

        # Kies de beste match: prefer type='wet', dan meest recente
        wetten = [r for r in zoek_result.regelingen if r.type == "wet"]
        if wetten:
            # Sorteer op geldig_vanaf descending (meest recente versie eerst)
            wetten.sort(key=lambda r: r.geldig_vanaf, reverse=True)
            regeling = wetten[0]
        else:
            regeling = zoek_result.regelingen[0]

        # Stap 2: Haal artikel op
        artikel = await client.artikel(
            bwb_id=regeling.bwb_id,
            artikel=req.artikel,
            lid=req.lid,
            peildatum=req.peildatum,
        )

        # Stap 3: Classificatie via LLM
        user = current_user
        if not user.api_key:
            raise HTTPException(400, "Geen API-key geconfigureerd. Ga naar Instellingen.")

        activiteit_2 = await run_classificatie(
            provider=user.provider,
            endpoint=user.endpoint,
            api_key=user.api_key,
            model=user.model,
            wet=artikel.citeertitel,
            bwb_id=artikel.bwb_id,
            artikel=artikel.artikel,
            versiedatum=artikel.versiedatum,
            bronreferentie=artikel.bronreferentie,
            leden=artikel.leden,
        )

        # Sla op in database
        analyse = {
            "id": analyse_id,
            "user_id": user.username,
            "status": "review_2",
            "wet": artikel.citeertitel,
            "bwb_id": artikel.bwb_id,
            "artikel": artikel.artikel,
            "versiedatum": artikel.versiedatum,
            "bronreferentie": artikel.bronreferentie,
            "sectie": artikel.sectie,
            "pad": artikel.pad,
            "activiteit_2": activiteit_2.model_dump(mode="json"),
            "activiteit_3": None,
            "review_feedback_2": "",
            "review_feedback_3": "",
            "rapport_md": "",
        }
        save_analyse(analyse)

        return {
            "analyse_id": analyse_id,
            "status": "review_2",
            "wet": artikel.citeertitel,
            "bwb_id": artikel.bwb_id,
            "artikel": artikel.artikel,
            "activiteit_2": activiteit_2.model_dump(mode="json"),
        }

    except McpError as e:
        logger.error("MCP-fout: %s", e)
        raise HTTPException(502, f"Fout bij ophalen wettekst: {e}")
    except LlmError as e:
        logger.error("LLM-fout: %s", e)
        raise HTTPException(502, f"Fout bij analyse: {e}")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Onverwachte fout bij analyse")
        raise HTTPException(500, "Er is een interne fout opgetreden.")


@router.post("/review")
async def submit_review(
    req: ReviewSubmit,
    current_user: User = Depends(get_current_user),
):
    """Verwerk review-feedback en ga door naar de volgende stap."""
    analyse = load_analyse(req.analyse_id, current_user.username)
    if not analyse:
        raise HTTPException(404, "Analyse niet gevonden")

    if req.activiteit == 2:
        if analyse["status"] != "review_2":
            raise HTTPException(400, f"Verwacht status review_2, kreeg {analyse['status']}")

        # Werk op een deepcopy zodat de originele dict bewaard blijft als save faalt
        analyse_copy = copy.deepcopy(analyse)

        # Verwerk feedback activiteit 2
        analyse_copy["review_feedback_2"] = req.algemeen

        if req.status == "wijzigingen" and req.items:
            markeringen = analyse_copy["activiteit_2"]["markeringen"]
            for m in markeringen:
                if m["id"] in req.items:
                    m["toelichting"] += f" [feedback: {req.items[m['id']]}]"
            analyse_copy["activiteit_2"]["markeringen"] = markeringen

        # Ga door naar activiteit 3
        try:
            user = current_user
            # Herconstrueer Activiteit2Data uit de database dict
            a2_obj = reconstruct_activiteit_2(analyse_copy["activiteit_2"])

            activiteit_3 = await run_betekenis(
                provider=user.provider,
                endpoint=user.endpoint,
                api_key=user.api_key,
                model=user.model,
                wet=analyse_copy["wet"],
                bwb_id=analyse_copy["bwb_id"],
                artikel=analyse_copy["artikel"],
                versiedatum=analyse_copy["versiedatum"],
                bronreferentie=analyse_copy["bronreferentie"],
                activiteit_2=a2_obj,
            )

            analyse_copy["activiteit_3"] = activiteit_3.model_dump(mode="json")
            analyse_copy["status"] = "review_3"
            save_analyse(analyse_copy)

            return {
                "analyse_id": req.analyse_id,
                "status": "review_3",
                "activiteit_3": _safe_dump(activiteit_3),
            }

        except LlmError as e:
            logger.error("LLM fout bij betekenisbepaling: %s", e)
            raise HTTPException(502, f"Fout bij betekenisbepaling: {e}")
        except ValidationError as e:
            logger.error("Validation fout bij betekenisbepaling: %s", e)
            raise HTTPException(502, f"Data-fout bij betekenisbepaling: {e}")
        except Exception as e:
            logger.exception("Onverwachte fout bij betekenisbepaling: %s", e)
            raise HTTPException(500, "Er is een interne fout opgetreden.")

    elif req.activiteit == 3:
        if analyse["status"] != "review_3":
            raise HTTPException(400, f"Verwacht status review_3, kreeg {analyse['status']}")

        try:
            # Werk op een deepcopy zodat de originele dict bewaard blijft als save faalt
            analyse_copy = copy.deepcopy(analyse)

            # Verwerk feedback activiteit 3
            analyse_copy["review_feedback_3"] = req.algemeen

            if req.status == "wijzigingen" and req.items:
                begrippen = analyse_copy["activiteit_3"]["begrippen"]
                for b in begrippen:
                    if b["id"] in req.items:
                        b["twijfel"] += f" [feedback: {req.items[b['id']]}]"
                analyse_copy["activiteit_3"]["begrippen"] = begrippen

            # Genereer rapport — herconstrueer modellen uit DB dicts (op kopie, geen mutatie)
            activiteit_2 = reconstruct_activiteit_2(analyse_copy["activiteit_2"])
            activiteit_3 = reconstruct_activiteit_3(analyse_copy["activiteit_3"])

            rapport = genereer_rapport(
                wet=analyse_copy["wet"],
                bwb_id=analyse_copy["bwb_id"],
                artikel=analyse_copy["artikel"],
                versiedatum=analyse_copy["versiedatum"],
                bronreferentie=analyse_copy["bronreferentie"],
                sectie=analyse_copy.get("sectie"),
                pad=analyse_copy.get("pad"),
                activiteit_2=activiteit_2,
                activiteit_3=activiteit_3,
                review_feedback_2=analyse_copy.get("review_feedback_2", ""),
                review_feedback_3=analyse_copy.get("review_feedback_3", ""),
            )

            analyse_copy["status"] = "klaar"
            analyse_copy["rapport_md"] = rapport
            save_analyse(analyse_copy)

            return {
                "analyse_id": req.analyse_id,
                "status": "klaar",
                "message": "Analyse voltooid. Rapport is beschikbaar.",
            }

        except ValidationError as e:
            logger.error("Validation fout bij rapport: %s", e)
            raise HTTPException(502, f"Data-fout bij rapport: {e}")
        except Exception as e:
            logger.exception("Onverwachte fout bij rapport: %s", e)
            raise HTTPException(500, "Er is een interne fout opgetreden.")



@router.get("/rapport/{analyse_id}")
async def get_rapport(
    analyse_id: str,
    current_user: User = Depends(get_current_user),
):
    """Haal het analyserapport op."""
    analyse = load_analyse(analyse_id, current_user.username)
    if not analyse:
        raise HTTPException(404, "Analyse niet gevonden")

    if analyse["status"] != "klaar":
        raise HTTPException(400, "Analyse is nog niet voltooid")

    rapport = analyse.get("rapport_md", "")
    if not rapport:
        # Genereer on-the-fly als het rapport niet is opgeslagen (op kopie, geen mutatie)
        activiteit_2 = reconstruct_activiteit_2(analyse["activiteit_2"])
        activiteit_3 = reconstruct_activiteit_3(analyse["activiteit_3"])

        rapport = genereer_rapport(
            wet=analyse["wet"],
            bwb_id=analyse["bwb_id"],
            artikel=analyse["artikel"],
            versiedatum=analyse["versiedatum"],
            bronreferentie=analyse["bronreferentie"],
            sectie=analyse.get("sectie"),
            pad=analyse.get("pad"),
            activiteit_2=activiteit_2,
            activiteit_3=activiteit_3,
            review_feedback_2=analyse.get("review_feedback_2", ""),
            review_feedback_3=analyse.get("review_feedback_3", ""),
        )

    return PlainTextResponse(rapport, media_type="text/markdown")


@router.get("/analyse/{analyse_id}")
async def get_analyse_status(
    analyse_id: str,
    current_user: User = Depends(get_current_user),
):
    """Haal de status van een analyse op."""
    analyse = load_analyse(analyse_id, current_user.username)
    if not analyse:
        raise HTTPException(404, "Analyse niet gevonden")

    return {
        "id": analyse["id"],
        "status": analyse["status"],
        "wet": analyse["wet"],
        "artikel": analyse["artikel"],
        "created_at": analyse.get("created_at", ""),
    }


@router.get("/analyses")
async def get_analyses(
    current_user: User = Depends(get_current_user),
):
    """Lijst van alle analyses van de ingelogde gebruiker."""
    analyses = list_analyses(current_user.username)
    return {"analyses": analyses}


@router.delete("/analyse/{analyse_id}")
async def delete_analyse_route(
    analyse_id: str,
    current_user: User = Depends(get_current_user),
):
    """Verwijder een analyse."""
    if delete_analyse(analyse_id, current_user.username):
        return {"message": "Analyse verwijderd"}
    raise HTTPException(404, "Analyse niet gevonden")
