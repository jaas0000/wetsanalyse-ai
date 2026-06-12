"""Async MongoDB-jobstore via Beanie.

Implementeert dezelfde interface als Store (filesystem), maar alle methoden zijn async.
Kritisch: save_job overschrijft uitsluitend state-machine velden — nooit rondes/rapport/naam/omschrijving.
"""

from __future__ import annotations

import asyncio

from .config import Settings
from .contracts import Analyse2, Analyse3, Feedback, Job
from .project import Project, RondeData, _utcnow

_STATE_FIELDS = frozenset({
    "state", "current_activiteit", "current_ronde", "waarschuwingen",
    "error", "provenance", "bwbId", "artikel", "lid", "review",
    "model_profile", "analysefocus", "client_id",
})

_locks: dict[str, asyncio.Lock] = {}


def lock_for(job_id: str) -> asyncio.Lock:
    return _locks.setdefault(job_id, asyncio.Lock())


class IdConflict(Exception):
    """Kon na meerdere pogingen geen vrije slug reserveren — gelijktijdige identieke aanmaak."""


class MongoStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    # --- id-afleiding ---

    async def afgeleid_id(self, bwb_id: str, artikel: str, lid: str | None) -> str:
        basis = f"{bwb_id.lower()}-art{artikel.lower().replace(' ', '')}"
        if lid:
            basis += f"-lid{lid}"
        kandidaat, n = basis, 1
        while await Project.find_one({"slug": kandidaat}):
            n += 1
            kandidaat = f"{basis}-{n}"
        return kandidaat

    # --- job (state-machine view) ---

    async def save_job(self, job: Job) -> None:
        project = await Project.find_one({"slug": job.id})
        if project is None:
            project = Project(slug=job.id)
            for field in _STATE_FIELDS:
                setattr(project, field, getattr(job, field, None))
            project.touch()
            await project.insert()
            return
        # Gericht $set: uitsluitend state-machine-velden. Schrijft nooit rondes/rapport/naam/
        # omschrijving, zodat een (mogelijk verouderde) job-snapshot die artefacten niet kan wissen.
        updates = {field: getattr(job, field, None) for field in _STATE_FIELDS}
        updates["updated"] = _utcnow()
        await project.set(updates)

    async def insert_job(self, job: Job) -> None:
        """Maak altijd een nieuw project-document aan (nooit bijwerken). Werpt
        DuplicateKeyError als de slug al bestaat — de aanroeper handelt de race af."""
        project = Project(slug=job.id)
        for field in _STATE_FIELDS:
            setattr(project, field, getattr(job, field, None))
        project.touch()
        await project.insert()

    async def load_job(self, job_id: str) -> Job | None:
        p = await Project.find_one({"slug": job_id})
        return p.to_job() if p else None

    async def list_jobs(self, client_id: str | None = None) -> list[Job]:
        query = {} if client_id is None else {"client_id": client_id}
        projects = await Project.find(query).to_list()
        return [p.to_job() for p in projects]

    # --- analyse (immutabel per ronde) ---

    async def hoogste_ronde(self, job_id: str, activiteit: str) -> int:
        p = await Project.find_one({"slug": job_id})
        if not p:
            return 0
        return max((int(k) for k in (p.rondes.get(activiteit) or {})), default=0)

    async def schrijf_analyse(self, job_id: str, activiteit: str, ronde: int, data: dict) -> None:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            raise KeyError(f"Onbekend project: {job_id}")
        key = str(ronde)
        bestaand = (p.rondes.get(activiteit) or {}).get(key)
        if bestaand is not None and bestaand.analyse:
            raise PermissionError(f"Ronde {ronde} act{activiteit} is immutabel.")
        # Gericht $set op het subpad — raakt alleen deze ronde, niet de rest van het document.
        await p.set({f"rondes.{activiteit}.{key}": RondeData(analyse=data), "updated": _utcnow()})

    async def lees_analyse(self, job_id: str, activiteit: str, ronde: int) -> dict | None:
        p = await Project.find_one({"slug": job_id})
        if not p:
            return None
        rd = (p.rondes.get(activiteit) or {}).get(str(ronde))
        return rd.analyse if rd and rd.analyse else None

    async def lees_analyse_model(self, job_id: str, activiteit: str, ronde: int):
        data = await self.lees_analyse(job_id, activiteit, ronde)
        if data is None:
            return None
        return (Analyse2 if activiteit == "2" else Analyse3).model_validate(data)

    async def lees_alle_rondes(self, job_id: str, activiteit: str) -> dict[str, RondeData]:
        p = await Project.find_one({"slug": job_id})
        return dict(p.rondes.get(activiteit) or {}) if p else {}

    # --- feedback ---

    async def schrijf_feedback(self, job_id: str, activiteit: str, ronde: int, fb: Feedback) -> None:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            raise KeyError(f"Onbekend project: {job_id}")
        key = str(ronde)
        bestaand = (p.rondes.get(activiteit) or {}).get(key)
        if bestaand is None:
            # Ronde bestaat nog niet: maak hem met lege analyse + de feedback.
            waarde = RondeData(analyse={}, feedback=fb.model_dump())
            await p.set({f"rondes.{activiteit}.{key}": waarde, "updated": _utcnow()})
        else:
            await p.set({f"rondes.{activiteit}.{key}.feedback": fb.model_dump(), "updated": _utcnow()})

    async def lees_feedback(self, job_id: str, activiteit: str, ronde: int) -> Feedback | None:
        p = await Project.find_one({"slug": job_id})
        if not p:
            return None
        rd = (p.rondes.get(activiteit) or {}).get(str(ronde))
        return Feedback.model_validate(rd.feedback) if rd and rd.feedback else None

    # --- rapport (embedded) ---

    async def schrijf_rapport(self, job_id: str, rapport: dict) -> None:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            return
        await p.set({"rapport": rapport, "updated": _utcnow()})

    async def lees_rapport(self, job_id: str) -> dict | None:
        p = await Project.find_one({"slug": job_id})
        return p.rapport if p else None

    # --- project CRUD (voor Fase B) ---

    async def load_project(self, job_id: str) -> Project | None:
        return await Project.find_one({"slug": job_id})

    async def list_projects(self, client_id: str | None = None) -> list[Project]:
        query = {} if client_id is None else {"client_id": client_id}
        return await Project.find(query).sort([("updated", -1)]).to_list()

    async def delete_project(self, job_id: str) -> bool:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            return False
        await p.delete()
        return True
