"""Domeinmodel voor een analyse-project (plain Pydantic; persistentie via app/db.py + de store).

Eén project draagt de state-machine + de afgeleide telemetrie. De gegenereerde artefacten
(rondes, feedback) staan in de aparte `rondes`-tabel en het eindrapport in een JSON-kolom; de
store vult `rapport` bij het laden en laat `rondes` leeg (consumenten lezen rondes uitsluitend via
de store-methoden, nooit via dit attribuut).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from .contracts import JobFout, JobState, RondeProvenance


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RondeData(BaseModel):
    analyse: dict = Field(default_factory=dict)
    feedback: dict | None = None


class Project(BaseModel):
    slug: str
    naam: str = ""
    omschrijving: str = ""

    bwbId: str = ""
    artikel: str = ""
    lid: str | None = None
    analysefocus: str = ""
    review: bool = True
    model_profile: str = ""
    client_id: str = ""

    state: JobState = JobState.queued
    current_activiteit: Literal["2", "3"] | None = None
    current_ronde: int = 0
    # Observerend, voor het live dashboard: de fijnmazige fase BINNEN een runt/bouwt-state
    # (bijv. "llm-generatie", "verwijzingen-volgen"). Bewust géén state-machine-veld — alleen
    # via store.set_current_fase geschreven, zodat fase-tikken de state-CAS en de
    # updated-sortering niet raken. None buiten een runt/bouwt.
    current_fase: str | None = None
    current_fase_sinds: datetime | None = None
    waarschuwingen: list[str] = Field(default_factory=list)
    error: JobFout | None = None
    provenance: list[RondeProvenance] = Field(default_factory=list)

    # Concurrency: alleen beheerd via store.claim() en de lease-heartbeat — NOOIT via save_job.
    # owner = per-proces id van de worker die de job verwerkt; lease_until = tot wanneer die
    # claim geldig is (verloopt → de reaper mag de job opruimen).
    owner: str | None = None
    lease_until: datetime | None = None

    created: datetime = Field(default_factory=_utcnow)
    updated: datetime = Field(default_factory=_utcnow)

    rondes: dict[str, dict[str, RondeData]] = Field(default_factory=dict)
    rapport: dict | None = None

    def touch(self) -> None:
        self.updated = _utcnow()

    def to_job(self):
        from .contracts import Job
        return Job(
            id=self.slug,
            bwbId=self.bwbId,
            artikel=self.artikel,
            lid=self.lid,
            review=self.review,
            model_profile=self.model_profile,
            analysefocus=self.analysefocus,
            client_id=self.client_id,
            state=self.state,
            current_activiteit=self.current_activiteit,
            current_ronde=self.current_ronde,
            waarschuwingen=self.waarschuwingen,
            error=self.error,
            provenance=self.provenance,
            created=self.created.isoformat(),
            updated=self.updated.isoformat(),
        )
