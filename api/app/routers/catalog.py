"""Lichte, niet-admin catalogus-endpoints voor de client-UI.

`GET /v1/profiles` geeft alleen de bruikbare profiel-namen + welke de default is — geen provider,
model, key of verbruik (dat is admin-only via /v1/admin/profiles). `GET /v1/wetten` geeft de
keuzelijst van geregistreerde wetten (BWB-id + naam) voor de dropdown in het analyseformulier.
Zo kan de client de dropdowns vullen zonder het admin-token, terwijl het beheer admin-only blijft.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import profiles, wetten
from ..auth import require_client

router = APIRouter(tags=["catalog"])


class ProfileChoice(BaseModel):
    name: str
    is_default: bool = False


class WetChoice(BaseModel):
    bwbId: str
    naam: str = ""


@router.get("/profiles", response_model=list[ProfileChoice])
async def lijst_profielen(_client_id: str = Depends(require_client)):
    items = await profiles.list_profiles()
    return [ProfileChoice(name=p.name, is_default=p.is_default) for p in items]


@router.get("/wetten", response_model=list[WetChoice])
async def lijst_wetten(_client_id: str = Depends(require_client)):
    items = await wetten.list_wetten()
    return [WetChoice(bwbId=w.bwbId, naam=w.naam) for w in items]
