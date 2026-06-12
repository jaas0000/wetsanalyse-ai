"""Beanie Document voor een analyse-project — alle artefacten embedded.

Één document per project bevat de state-machine én alle gegenereerde artefacten
(rondes, rapport). De 16MB BSON-limiet is ruim voor wetsartikelen.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from beanie import Document
from pymongo import ASCENDING, DESCENDING, IndexModel
from pydantic import BaseModel, Field

from .contracts import JobFout, JobState, RondeProvenance


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RondeData(BaseModel):
    analyse: dict = Field(default_factory=dict)
    feedback: dict | None = None


class Project(Document):
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
    waarschuwingen: list[str] = Field(default_factory=list)
    error: JobFout | None = None
    provenance: list[RondeProvenance] = Field(default_factory=list)

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

    class Settings:
        name = "projects"
        indexes = [
            IndexModel([("slug", ASCENDING)], unique=True),
            IndexModel([("state", ASCENDING)]),
            IndexModel([("updated", DESCENDING)]),
        ]
