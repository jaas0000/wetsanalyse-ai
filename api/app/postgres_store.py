"""Async PostgreSQL-jobstore via SQLAlchemy Core — de concrete JobStore-implementatie (zie jobstore.py).

De mechanismen:
  - atomaire state-CAS (`claim`/`verleng_lease`/`set_current_fase`) → één `UPDATE ... WHERE ... RETURNING`;
  - owner-fencing → een extra `owner = :owner` in de WHERE;
  - ronde-immutabiliteit → een aparte `rondes`-tabel met (project, activiteit, ronde) als sleutel;
  - de tijd komt uit Python (`db.utcnow`), niet uit SQL, zodat de queries portable blijven (SQLite-tests).

Kritisch (net als voorheen): save_job overschrijft uitsluitend state-machine-velden — nooit
rondes/rapport/naam/omschrijving.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from . import db
from .config import Settings
from .contracts import Analyse2, Analyse3, Feedback, Job, JobState, RUNNING_STATES, RondeProvenance
from .jobstore import IdConflict
from .project import Project, RondeData

# Velden die save_job mag overschrijven. Bewust ZONDER owner/lease_until: die worden uitsluitend
# door claim()/verleng_lease() beheerd, zodat een stale Job-snapshot de lease nooit kan overschrijven.
_STATE_FIELDS = (
    "state", "current_activiteit", "current_ronde", "waarschuwingen",
    "error", "provenance", "bwbId", "artikel", "lid", "review",
    "model_profile", "analysefocus", "client_id",
)


def _serialize(value):
    """pydantic/enum → JSON-vriendelijke waarde voor een JSON(B)-kolom."""
    if hasattr(value, "value") and isinstance(value, JobState):
        return value.value
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="python")
    if isinstance(value, list):
        return [x.model_dump(mode="python") if hasattr(x, "model_dump") else x for x in value]
    return value


def _state_values(job: Job) -> dict:
    """De state-machine-velden van een Job als kolom→waarde-blok (geserialiseerd)."""
    return {field: _serialize(getattr(job, field, None)) for field in _STATE_FIELDS}


def _row_to_project(row) -> Project:
    """Bouw een Project-domeinmodel uit een projects-rij (datetimes UTC-aware, JSON → modellen)."""
    m = dict(row)
    return Project(
        slug=m["slug"],
        naam=m["naam"] or "",
        omschrijving=m["omschrijving"] or "",
        bwbId=m["bwbId"] or "",
        artikel=m["artikel"] or "",
        lid=m["lid"],
        analysefocus=m["analysefocus"] or "",
        review=m["review"],
        model_profile=m["model_profile"] or "",
        client_id=m["client_id"] or "",
        state=JobState(m["state"]),
        current_activiteit=m["current_activiteit"],
        current_ronde=m["current_ronde"] or 0,
        current_fase=m["current_fase"],
        current_fase_sinds=db.aware(m["current_fase_sinds"]),
        waarschuwingen=list(m["waarschuwingen"] or []),
        error=m["error"],
        provenance=[RondeProvenance(**p) for p in (m["provenance"] or [])],
        owner=m["owner"],
        lease_until=db.aware(m["lease_until"]),
        created=db.aware(m["created"]),
        updated=db.aware(m["updated"]),
        rapport=m["rapport"],
    )


class PostgresStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    # --- id-afleiding ---

    async def afgeleid_id(self, bwb_id: str, artikel: str, lid: str | None) -> str:
        basis = f"{bwb_id.lower()}-art{artikel.lower().replace(' ', '')}"
        if lid:
            basis += f"-lid{lid}"
        kandidaat, n = basis, 1
        async with db.get_engine().connect() as conn:
            while True:
                row = await conn.execute(
                    select(db.projects.c.slug).where(db.projects.c.slug == kandidaat)
                )
                if row.first() is None:
                    return kandidaat
                n += 1
                kandidaat = f"{basis}-{n}"

    # --- job (state-machine view) ---

    async def save_job(self, job: Job, *, owner: str | None = None) -> bool:
        """Schrijf de state-machine-velden. Met `owner` is de write *fenced*: hij landt alleen als
        die owner de job nog bezit (verloren lease → False, geen clobber). Return True = geschreven.

        Schrijft nooit rondes/rapport/naam/omschrijving, zodat een verouderde snapshot die
        artefacten niet kan wissen."""
        now = db.utcnow()
        values = _state_values(job)
        async with db.get_engine().begin() as conn:
            bestaat = (await conn.execute(
                select(db.projects.c.slug).where(db.projects.c.slug == job.id)
            )).first() is not None
            if not bestaat:
                await conn.execute(insert(db.projects).values(
                    slug=job.id, created=now, updated=now, **values
                ))
                return True
            stmt = update(db.projects).where(db.projects.c.slug == job.id)
            if owner is not None:
                stmt = stmt.where(db.projects.c.owner == owner)
            res = await conn.execute(stmt.values(updated=now, **values))
            return res.rowcount == 1

    async def set_current_fase(self, job_id: str, fase: str | None, owner: str) -> bool:
        """Observerende, owner-fenced single-field update voor het live dashboard. Schrijft
        UITSLUITEND current_fase (+ _sinds) — nooit `updated`, `state`, owner of lease, zodat de
        fijnmazige fase-tikken de homepage-sortering (op `updated`) en de state-machine ongemoeid
        laten. Verkeerde/verloren owner → geen match → False (best-effort aan de aanroepkant)."""
        async with db.get_engine().begin() as conn:
            res = await conn.execute(
                update(db.projects)
                .where(db.projects.c.slug == job_id, db.projects.c.owner == owner)
                .values(current_fase=fase, current_fase_sinds=db.utcnow() if fase else None)
            )
        return res.rowcount == 1

    async def insert_job(self, job: Job) -> None:
        """Maak altijd een nieuw project-document aan (nooit bijwerken). Werpt IdConflict als de
        slug al bestaat — de aanroeper handelt de race af."""
        now = db.utcnow()
        try:
            async with db.get_engine().begin() as conn:
                await conn.execute(insert(db.projects).values(
                    slug=job.id, created=now, updated=now, **_state_values(job)
                ))
        except IntegrityError:
            raise IdConflict(f"slug bestaat al: {job.id}")

    async def create_project(self, project: Project) -> None:
        """Maak een volledig project-document aan (incl. naam/omschrijving). Werpt IdConflict bij
        een dubbele slug."""
        now = db.utcnow()
        try:
            async with db.get_engine().begin() as conn:
                await conn.execute(insert(db.projects).values(
                    slug=project.slug,
                    naam=project.naam,
                    omschrijving=project.omschrijving,
                    bwbId=project.bwbId,
                    artikel=project.artikel,
                    lid=project.lid,
                    analysefocus=project.analysefocus,
                    review=project.review,
                    model_profile=project.model_profile,
                    client_id=project.client_id,
                    state=project.state.value,
                    current_ronde=project.current_ronde,
                    waarschuwingen=[],
                    provenance=[],
                    created=now,
                    updated=now,
                ))
        except IntegrityError:
            raise IdConflict(f"slug bestaat al: {project.slug}")

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
        """Atomaire state-transitie (CAS): zet de job van een van de `van`-states naar `naar` en
        claim 'm voor `owner` met een verse lease. Slaagt de match → de aanroeper bezit de job
        (return Job); geen match (andere state/andere worker bezig) → None."""
        now = db.utcnow()
        stmt = (
            update(db.projects)
            .where(
                db.projects.c.slug == job_id,
                db.projects.c.state.in_([s.value for s in van]),
            )
        )
        if vereist_verlopen_lease:
            stmt = stmt.where(db.projects.c.lease_until < now)
        stmt = stmt.values(
            state=naar.value,
            owner=owner,
            lease_until=now + timedelta(seconds=lease_s),
            updated=now,
        ).returning(db.projects)
        async with db.get_engine().begin() as conn:
            row = (await conn.execute(stmt)).mappings().first()
        return _row_to_project(row).to_job() if row is not None else None

    async def verleng_lease(self, job_id: str, owner: str, lease_s: int) -> bool:
        """Heartbeat: verleng de lease, maar UITSLUITEND zolang `owner` de job nog bezit en hij in
        een runt-state staat. Geen match → de worker is zijn lease kwijt (return False)."""
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            res = await conn.execute(
                update(db.projects)
                .where(
                    db.projects.c.slug == job_id,
                    db.projects.c.owner == owner,
                    db.projects.c.state.in_([s.value for s in RUNNING_STATES]),
                )
                .values(lease_until=now + timedelta(seconds=lease_s))
            )
        return res.rowcount == 1

    async def lijst_verlopen_running(self) -> list[str]:
        """Ids van runt-jobs met een verlopen lease — input voor de reaper."""
        now = db.utcnow()
        async with db.get_engine().connect() as conn:
            rows = await conn.execute(
                select(db.projects.c.slug).where(
                    db.projects.c.state.in_([s.value for s in RUNNING_STATES]),
                    db.projects.c.lease_until < now,
                )
            )
        return [r[0] for r in rows.all()]

    async def markeer_lease_loze_running(self) -> int:
        """Migratie-/herstelvangnet: geef runt-jobs zónder lease (pre-upgrade of na een crash waar
        het lease-veld nooit gezet werd) een verlopen lease, zodat de reaper ze oppakt. Jobs met een
        nog-geldige lease blijven ongemoeid."""
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            res = await conn.execute(
                update(db.projects)
                .where(
                    db.projects.c.state.in_([s.value for s in RUNNING_STATES]),
                    db.projects.c.lease_until.is_(None),
                )
                .values(lease_until=now - timedelta(seconds=1))
            )
        return res.rowcount

    async def load_job(self, job_id: str) -> Job | None:
        p = await self.load_project(job_id)
        return p.to_job() if p else None

    async def list_jobs(self, client_id: str | None = None) -> list[Job]:
        return [p.to_job() for p in await self.list_projects(client_id)]

    # --- analyse (immutabel per ronde) ---

    async def _project_bestaat(self, conn, job_id: str) -> bool:
        row = await conn.execute(select(db.projects.c.slug).where(db.projects.c.slug == job_id))
        return row.first() is not None

    async def _ronde_row(self, conn, job_id: str, activiteit: str, ronde: int):
        return (await conn.execute(
            select(db.rondes).where(
                db.rondes.c.project_slug == job_id,
                db.rondes.c.activiteit == activiteit,
                db.rondes.c.ronde == ronde,
            )
        )).mappings().first()

    async def hoogste_ronde(self, job_id: str, activiteit: str) -> int:
        async with db.get_engine().connect() as conn:
            res = await conn.execute(
                select(func.max(db.rondes.c.ronde)).where(
                    db.rondes.c.project_slug == job_id,
                    db.rondes.c.activiteit == activiteit,
                )
            )
        return res.scalar() or 0

    async def schrijf_analyse(self, job_id: str, activiteit: str, ronde: int, data: dict) -> None:
        async with db.get_engine().begin() as conn:
            if not await self._project_bestaat(conn, job_id):
                raise KeyError(f"Onbekend project: {job_id}")
            bestaand = await self._ronde_row(conn, job_id, activiteit, ronde)
            if bestaand is not None and bestaand["analyse"]:
                raise PermissionError(f"Ronde {ronde} act{activiteit} is immutabel.")
            if bestaand is None:
                await conn.execute(insert(db.rondes).values(
                    project_slug=job_id, activiteit=activiteit, ronde=ronde, analyse=data,
                ))
            else:
                await conn.execute(
                    update(db.rondes).where(
                        db.rondes.c.project_slug == job_id,
                        db.rondes.c.activiteit == activiteit,
                        db.rondes.c.ronde == ronde,
                    ).values(analyse=data)
                )
            await conn.execute(
                update(db.projects).where(db.projects.c.slug == job_id).values(updated=db.utcnow())
            )

    async def lees_analyse(self, job_id: str, activiteit: str, ronde: int) -> dict | None:
        async with db.get_engine().connect() as conn:
            row = await self._ronde_row(conn, job_id, activiteit, ronde)
        if row is None or not row["analyse"]:
            return None
        return row["analyse"]

    async def lees_analyse_model(self, job_id: str, activiteit: str, ronde: int):
        data = await self.lees_analyse(job_id, activiteit, ronde)
        if data is None:
            return None
        return (Analyse2 if activiteit == "2" else Analyse3).model_validate(data)

    async def lees_alle_rondes(self, job_id: str, activiteit: str) -> dict[str, RondeData]:
        async with db.get_engine().connect() as conn:
            rows = (await conn.execute(
                select(db.rondes).where(
                    db.rondes.c.project_slug == job_id,
                    db.rondes.c.activiteit == activiteit,
                )
            )).mappings().all()
        return {
            str(r["ronde"]): RondeData(analyse=r["analyse"] or {}, feedback=r["feedback"])
            for r in rows
        }

    # --- feedback ---

    async def schrijf_feedback(self, job_id: str, activiteit: str, ronde: int, fb: Feedback) -> None:
        async with db.get_engine().begin() as conn:
            if not await self._project_bestaat(conn, job_id):
                raise KeyError(f"Onbekend project: {job_id}")
            bestaand = await self._ronde_row(conn, job_id, activiteit, ronde)
            if bestaand is None:
                await conn.execute(insert(db.rondes).values(
                    project_slug=job_id, activiteit=activiteit, ronde=ronde,
                    analyse={}, feedback=fb.model_dump(),
                ))
            else:
                await conn.execute(
                    update(db.rondes).where(
                        db.rondes.c.project_slug == job_id,
                        db.rondes.c.activiteit == activiteit,
                        db.rondes.c.ronde == ronde,
                    ).values(feedback=fb.model_dump())
                )
            await conn.execute(
                update(db.projects).where(db.projects.c.slug == job_id).values(updated=db.utcnow())
            )

    async def lees_feedback(self, job_id: str, activiteit: str, ronde: int) -> Feedback | None:
        async with db.get_engine().connect() as conn:
            row = await self._ronde_row(conn, job_id, activiteit, ronde)
        if row is None or not row["feedback"]:
            return None
        return Feedback.model_validate(row["feedback"])

    # --- rapport (JSON-kolom op het project) ---

    async def schrijf_rapport(self, job_id: str, rapport: dict) -> None:
        async with db.get_engine().begin() as conn:
            res = await conn.execute(
                update(db.projects).where(db.projects.c.slug == job_id)
                .values(rapport=rapport, updated=db.utcnow())
            )
        # Stil zwijgen als het project niet bestaat (geen exception).
        _ = res

    async def lees_rapport(self, job_id: str) -> dict | None:
        async with db.get_engine().connect() as conn:
            res = await conn.execute(
                select(db.projects.c.rapport).where(db.projects.c.slug == job_id)
            )
        row = res.first()
        return row[0] if row is not None else None

    # --- project CRUD ---

    async def load_project(self, job_id: str) -> Project | None:
        async with db.get_engine().connect() as conn:
            row = (await conn.execute(
                select(db.projects).where(db.projects.c.slug == job_id)
            )).mappings().first()
        return _row_to_project(row) if row is not None else None

    async def list_projects(
        self, client_id: str | None = None, *, limit: int | None = None, offset: int = 0
    ) -> list[Project]:
        stmt = select(db.projects)
        if client_id is not None:
            stmt = stmt.where(db.projects.c.client_id == client_id)
        stmt = stmt.order_by(db.projects.c.updated.desc()).offset(offset)
        if limit is not None:
            stmt = stmt.limit(limit)
        async with db.get_engine().connect() as conn:
            rows = (await conn.execute(stmt)).mappings().all()
        return [_row_to_project(r) for r in rows]

    async def delete_project(self, job_id: str) -> bool:
        async with db.get_engine().begin() as conn:
            await conn.execute(delete(db.rondes).where(db.rondes.c.project_slug == job_id))
            res = await conn.execute(delete(db.projects).where(db.projects.c.slug == job_id))
        return res.rowcount == 1
