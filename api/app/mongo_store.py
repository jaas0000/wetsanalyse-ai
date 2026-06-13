"""Async MongoDB-jobstore via Beanie — de concrete JobStore-implementatie (zie jobstore.py).

Kritisch: save_job overschrijft uitsluitend state-machine velden — nooit rondes/rapport/naam/omschrijving.
"""

from __future__ import annotations

from datetime import timedelta

from .config import Settings
from .contracts import Analyse2, Analyse3, Feedback, Job, JobState, RUNNING_STATES
from .project import Project, RondeData, _utcnow

# Velden die save_job mag overschrijven. Bewust ZONDER owner/lease_until: die worden
# uitsluitend door claim()/verleng_lease() beheerd, zodat een stale Job-snapshot de lease
# (en daarmee het eigenaarschap) nooit kan overschrijven.
_STATE_FIELDS = frozenset({
    "state", "current_activiteit", "current_ronde", "waarschuwingen",
    "error", "provenance", "bwbId", "artikel", "lid", "review",
    "model_profile", "analysefocus", "client_id",
})


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

    @staticmethod
    def _state_payload(job: Job) -> dict:
        """Serialiseer de state-velden naar een BSON-vriendelijk $set-blok (pydantic → dict)."""
        payload: dict = {}
        for field in _STATE_FIELDS:
            v = getattr(job, field, None)
            if hasattr(v, "model_dump"):
                v = v.model_dump(mode="python")
            elif isinstance(v, list):
                v = [x.model_dump(mode="python") if hasattr(x, "model_dump") else x for x in v]
            payload[field] = v
        payload["updated"] = _utcnow()
        return payload

    async def save_job(self, job: Job, *, owner: str | None = None) -> bool:
        """Schrijf de state-machine-velden. Met `owner` is de write *fenced*: hij landt alleen als
        die owner de job nog bezit (verloren lease → False, geen clobber). Return True = geschreven.

        Gericht $set: uitsluitend state-machine-velden. Schrijft nooit rondes/rapport/naam/
        omschrijving, zodat een (mogelijk verouderde) job-snapshot die artefacten niet kan wissen.
        """
        project = await Project.find_one({"slug": job.id})
        if project is None:
            project = Project(slug=job.id)
            for field in _STATE_FIELDS:
                setattr(project, field, getattr(job, field, None))
            project.touch()
            await project.insert()
            return True
        if owner is None:
            updates = {field: getattr(job, field, None) for field in _STATE_FIELDS}
            updates["updated"] = _utcnow()
            await project.set(updates)
            return True
        # Fenced: atomair en uitsluitend zolang wij de job bezitten.
        coll = Project.get_motor_collection()
        res = await coll.update_one(
            {"slug": job.id, "owner": owner}, {"$set": self._state_payload(job)}
        )
        return res.matched_count == 1

    async def insert_job(self, job: Job) -> None:
        """Maak altijd een nieuw project-document aan (nooit bijwerken). Werpt
        DuplicateKeyError als de slug al bestaat — de aanroeper handelt de race af."""
        project = Project(slug=job.id)
        for field in _STATE_FIELDS:
            setattr(project, field, getattr(job, field, None))
        project.touch()
        await project.insert()

    async def claim(
        self,
        job_id: str,
        van: set[JobState],
        naar: JobState,
        owner: str,
        lease_s: int,
        *,
        vereist_verlopen_lease: bool = False,
    ) -> Job | None:
        """Atomaire state-transitie (Mongo CAS): zet de job van een van de `van`-states naar
        `naar` en claim 'm voor `owner` met een verse lease. Slaagt de match → de aanroeper
        bezit de job (return Job); geen match (andere state/andere worker bezig) → None.

        Dit vervangt de in-process lock: alleen de transitie HOEFT atomair, de runt-state zelf
        fungeert daarna als 'claimed'-marker zodat geen tweede worker dezelfde job oppakt.
        """
        now = _utcnow()
        filter_: dict = {"slug": job_id, "state": {"$in": [s.value for s in van]}}
        if vereist_verlopen_lease:
            filter_["lease_until"] = {"$lt": now}
        update = {"$set": {
            "state": naar.value,
            "owner": owner,
            "lease_until": now + timedelta(seconds=lease_s),
            "updated": now,
        }}
        coll = Project.get_motor_collection()
        doc = await coll.find_one_and_update(filter_, update, return_document=True)
        if doc is None:
            return None
        return Project.model_validate(doc).to_job()

    async def verleng_lease(self, job_id: str, owner: str, lease_s: int) -> bool:
        """Heartbeat: verleng de lease, maar UITSLUITEND zolang `owner` de job nog bezit en hij
        in een runt-state staat. Geen match → de worker is zijn lease kwijt (return False)."""
        now = _utcnow()
        coll = Project.get_motor_collection()
        res = await coll.update_one(
            {"slug": job_id, "owner": owner, "state": {"$in": [s.value for s in RUNNING_STATES]}},
            {"$set": {"lease_until": now + timedelta(seconds=lease_s)}},
        )
        # matched_count (niet modified_count): de vraag is of WIJ de job nog bezitten, niet of
        # de lease-waarde feitelijk veranderde — dat is de fencing-semantiek.
        return res.matched_count == 1

    async def lijst_verlopen_running(self) -> list[str]:
        """Ids van runt-jobs met een verlopen lease — input voor de reaper."""
        now = _utcnow()
        cursor = Project.find({
            "state": {"$in": [s.value for s in RUNNING_STATES]},
            "lease_until": {"$lt": now},
        })
        return [p.slug for p in await cursor.to_list()]

    async def markeer_lease_loze_running(self) -> int:
        """Migratie-/herstelvangnet: geef runt-jobs zónder lease (pre-upgrade of na een crash waar
        het lease-veld nooit gezet werd) een verlopen lease, zodat de reaper ze in de volgende ronde
        oppakt. Jobs met een nog-geldige lease zijn van een levende worker en blijven ongemoeid:
        het `$lt: now`-filter van de reaper raakt ze niet, maar een ontbrekend veld matcht dat filter
        ook niet → zonder deze markering zouden ze eeuwig hangen."""
        now = _utcnow()
        coll = Project.get_motor_collection()
        res = await coll.update_many(
            {
                "state": {"$in": [s.value for s in RUNNING_STATES]},
                "$or": [{"lease_until": None}, {"lease_until": {"$exists": False}}],
            },
            {"$set": {"lease_until": now - timedelta(seconds=1)}},
        )
        return res.modified_count

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

    async def list_projects(
        self, client_id: str | None = None, *, limit: int | None = None, offset: int = 0
    ) -> list[Project]:
        query = {} if client_id is None else {"client_id": client_id}
        q = Project.find(query).sort([("updated", -1)]).skip(offset)
        if limit is not None:
            q = q.limit(limit)
        return await q.to_list()

    async def delete_project(self, job_id: str) -> bool:
        p = await Project.find_one({"slug": job_id})
        if p is None:
            return False
        await p.delete()
        return True
