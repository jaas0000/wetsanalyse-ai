"""Berichtensysteem — analist-resource (gemount onder /v1/berichten).

Alle endpoints vereisen een geldig client-bearer-token (`require_client`) én een `X-User-Id`-header
die de BFF uit de ingelogde sessie zet — de identiteit komt zo nooit uit browser-input.

GET  /v1/berichten/ongelezen-aantal   — aantal ongelezen gepubliceerde berichten
POST /v1/berichten/lees-alles         — markeer alle gepubliceerde berichten als gelezen
GET  /v1/berichten                    — lijst gepubliceerde berichten (max 20, met gelezen-vlag)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from .. import berichten as svc
from ..auth import require_client
from .auth import huidige_userid

router = APIRouter(
    prefix="/berichten",
    tags=["berichten"],
    dependencies=[Depends(require_client)],
)


# --- modellen ------------------------------------------------------------------

class OngelezenAantalOut(BaseModel):
    aantal: int


class BerichtOut(BaseModel):
    id: int
    titel: str
    inhoud: str
    type: str
    versie: str | None = None
    gepubliceerd: bool
    gelezen: bool = False
    aangemaakt_door: str = ""
    created: str = ""
    updated: str = ""


def _to_out(row: dict) -> BerichtOut:
    return BerichtOut(
        id=row["id"],
        titel=row["titel"],
        inhoud=row["inhoud"],
        type=row["type"],
        versie=row.get("versie"),
        gepubliceerd=row["gepubliceerd"],
        gelezen=bool(row.get("gelezen", False)),
        aangemaakt_door=row.get("aangemaakt_door", ""),
        created=row["created"].isoformat() if row.get("created") else "",
        updated=row["updated"].isoformat() if row.get("updated") else "",
    )


# --- endpoints (static routes vóór parameterized) ------------------------------

@router.get("/ongelezen-aantal", response_model=OngelezenAantalOut)
async def get_ongelezen_aantal(userid: str = Depends(huidige_userid)):
    aantal = await svc.ongelezen_aantal(userid)
    return OngelezenAantalOut(aantal=aantal)


@router.post("/lees-alles", status_code=status.HTTP_204_NO_CONTENT)
async def post_lees_alles(userid: str = Depends(huidige_userid)):
    await svc.markeer_alles_gelezen(userid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[BerichtOut])
async def get_berichten(userid: str = Depends(huidige_userid)):
    rows = await svc.list_berichten(userid)
    return [_to_out(r) for r in rows]
