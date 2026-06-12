"""Async MongoDB-jobstore via Beanie.

Implementeert dezelfde interface als Store (filesystem), maar alle methoden zijn async.
Kritisch: save_job overschrijft uitsluitend state-machine velden — nooit rondes/rapport/naam/omschrijving.
"""

from __future__ import annotations

import asyncio

from .config import Settings
from .contracts import Analyse2, Analyse3, Feedback, Job
from .project import Project, RondeData

_STATE_FIELDS = frozenset({
    "state", "current_activiteit", "current_ronde", "waarschuwingen",
    "error", "provenance", "bwbId", "artikel", "lid", "review",
    "model_profile", "analysefocus", "client_id",
})

_locks: dict[str, asyncio.Lock] = {}


def lock_for(job_id: str) -> asyncio.Lock:
    return _locks.setdefault(job_id, asyncio.Lock())


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
            await project.insert()
        for field in _STATE_FIELDS:
            val = getattr(job, field, None)
            setattr(project, field, val)
        project.touch()
        await project.save()

    async def load_job(self, job_id: str) -> Job | None:
        p = await Project.find_one({"slug": job_id})
        return p.to_job() if p else None

    async def list_jobs(self) -> list[Job]:
        projects = await Project.find_all().to_list()
        return [p.to_job() for p in projects]

    # --- analyse (immutabel per ronde) ---

    async def hoogste_ronde(self, job_id: str, activiteit: str) -> int:
        p = await Project.find_one({"slug": job_id})
        if not p:
            return 0
        return max((int(k) for k in (p.rondes.get(activiteit) or {})), default=0)

    async def schrijf_analyse(self, job_id: str, activiteit: str, ronde: int, data: dict) -> None:
        p = await Project.find_one({"slug": job_id})
        act = p.rondes.setdefault(activiteit, {})
        key = str(ronde)
        if key in act and act[key].analyse:
            raise PermissionError(f"Ronde {ronde} act{activiteit} is immutabel.")
        act[key] = RondeData(analyse=data)
        p.touch()
        await p.save()

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
        act = p.rondes.setdefault(activiteit, {})
        key = str(ronde)
        if key not in act:
            act[key] = RondeData(analyse={})
        act[key].feedback = fb.model_dump()
        p.touch()
        await p.save()

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
        p.rapport = rapport
        p.touch()
        await p.save()

    async def lees_rapport(self, job_id: str) -> dict | None:
        p = await Project.find_one({"slug": job_id})
        return p.rapport if p else None

    # --- project CRUD (voor Fase B) ---

    async def load_project(self, job_id: str) -> Project | None:
        return await Project.find_one({"slug": job_id})

    async def list_projects(self) -> list[Project]:
        return await Project.find({}).sort([("updated", -1)]).to_list()

    async def delete_project(self, job_id: str) -> bool:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            return False
        await p.delete()
        return True
