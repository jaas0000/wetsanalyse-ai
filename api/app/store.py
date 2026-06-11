"""Filesystem-jobstore over analyses/<id>/ — de mappenstructuur ís de jobstore.

Invarianten (dezelfde die write_guard.py lokaal afdwingt, hier in de store zodat ze ook
buiten Claude Code gelden):
  - een bestaande, niet-lege ronde-N/analyse.json is IMMUTABEL (nooit overschrijven);
  - feedback.json wordt uitsluitend door de API geschreven, alleen in een review-state;
  - alle writes zijn atomair (temp + os.replace) zodat een crash geen half bestand achterlaat.

Per-job asyncio.Lock serialiseert state-transities (single-worker-aanname, zie plan).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path

from .config import Settings
from .contracts import Analyse2, Analyse3, Feedback, Job

_RONDE_RE = re.compile(r"ronde-(\d+)")
_locks: dict[str, asyncio.Lock] = {}


def lock_for(job_id: str) -> asyncio.Lock:
    return _locks.setdefault(job_id, asyncio.Lock())


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _dump(model) -> str:
    return json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=2)


class Store:
    def __init__(self, settings: Settings) -> None:
        self.root = settings.analyses_dir

    # --- id-afleiding -----------------------------------------------------

    def afgeleid_id(self, bwb_id: str, artikel: str, lid: str | None) -> str:
        """`<bwbid>-art<nr>[-lidN]` in kleine letters; suffix bij collisie."""
        basis = f"{bwb_id.lower()}-art{artikel.lower().replace(' ', '')}"
        if lid:
            basis += f"-lid{lid}"
        kandidaat = basis
        n = 1
        while (self.root / kandidaat).exists():
            n += 1
            kandidaat = f"{basis}-{n}"
        return kandidaat

    # --- paden ------------------------------------------------------------

    def job_dir(self, job_id: str) -> Path:
        return self.root / job_id

    def werk_dir(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "werk"

    def ronde_dir(self, job_id: str, activiteit: str, ronde: int) -> Path:
        return self.werk_dir(job_id) / f"activiteit-{activiteit}" / f"ronde-{ronde}"

    def _job_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "job.json"

    # --- job.json ---------------------------------------------------------

    def save_job(self, job: Job) -> None:
        job.touch()
        _atomic_write(self._job_path(job.id), _dump(job))

    def load_job(self, job_id: str) -> Job | None:
        p = self._job_path(job_id)
        if not p.exists():
            return None
        return Job.model_validate_json(p.read_text(encoding="utf-8"))

    def list_jobs(self) -> list[Job]:
        if not self.root.is_dir():
            return []
        jobs = []
        for d in sorted(self.root.iterdir()):
            if d.is_dir() and (d / "job.json").exists():
                job = self.load_job(d.name)
                if job:
                    jobs.append(job)
        return jobs

    # --- analyse.json (immutabel per ronde) -------------------------------

    def hoogste_ronde(self, job_id: str, activiteit: str) -> int:
        act_dir = self.werk_dir(job_id) / f"activiteit-{activiteit}"
        if not act_dir.is_dir():
            return 0
        nrs = [
            int(m.group(1))
            for p in act_dir.glob("ronde-*")
            if p.is_dir() and (m := _RONDE_RE.fullmatch(p.name))
        ]
        return max(nrs, default=0)

    def analyse_pad(self, job_id: str, activiteit: str, ronde: int) -> Path:
        return self.ronde_dir(job_id, activiteit, ronde) / "analyse.json"

    def schrijf_analyse(self, job_id: str, activiteit: str, ronde: int, data: dict) -> None:
        pad = self.analyse_pad(job_id, activiteit, ronde)
        if pad.exists() and pad.read_text(encoding="utf-8").strip():
            raise PermissionError(
                f"analyse.json bestaat al en is immutabel: {pad} (gebruik ronde-{ronde + 1})"
            )
        _atomic_write(pad, json.dumps(data, ensure_ascii=False, indent=2))

    def lees_analyse(self, job_id: str, activiteit: str, ronde: int) -> dict | None:
        pad = self.analyse_pad(job_id, activiteit, ronde)
        if not pad.exists():
            return None
        return json.loads(pad.read_text(encoding="utf-8"))

    def lees_analyse_model(self, job_id: str, activiteit: str, ronde: int):
        data = self.lees_analyse(job_id, activiteit, ronde)
        if data is None:
            return None
        return (Analyse2 if activiteit == "2" else Analyse3).model_validate(data)

    # --- feedback.json (alleen de API, alleen in review-state) ------------

    def feedback_pad(self, job_id: str, activiteit: str, ronde: int) -> Path:
        return self.ronde_dir(job_id, activiteit, ronde) / "feedback.json"

    def schrijf_feedback(self, job_id: str, activiteit: str, ronde: int, fb: Feedback) -> None:
        _atomic_write(self.feedback_pad(job_id, activiteit, ronde), _dump(fb))

    def lees_feedback(self, job_id: str, activiteit: str, ronde: int) -> Feedback | None:
        pad = self.feedback_pad(job_id, activiteit, ronde)
        if not pad.exists():
            return None
        return Feedback.model_validate_json(pad.read_text(encoding="utf-8"))

    # --- rapport ----------------------------------------------------------

    def rapport_pad(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "rapport.json"
