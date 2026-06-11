"""De analyse-endpoints. POST /analyses is async (202 + polling); langlopend werk draait in
een achtergrondtaak. POST /feedback is alleen geldig in een wacht-op-review-state (anders 409)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse

from ..auth import require_client
from ..contracts import Feedback, JobState, REVIEW_STATES, StartRequest
from ..deps import get_engine, get_store, schedule

router = APIRouter(prefix="/analyses", tags=["analyses"])


def _job_or_404(store, job_id: str):
    job = store.load_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Onbekende analyse: {job_id}")
    return job


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def start_analyse(req: StartRequest, client_id: str = Depends(require_client)):
    try:
        engine = get_engine()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Engine niet beschikbaar: {e}")
    try:
        job = engine.create_job(req, client_id)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    schedule(engine.run_initial(job.id))
    return {"id": job.id, "state": job.state}


@router.get("")
async def lijst_analyses(client_id: str = Depends(require_client)):
    store = get_store()
    return [
        {"id": j.id, "state": j.state, "bwbId": j.bwbId, "artikel": j.artikel, "updated": j.updated}
        for j in store.list_jobs()
    ]


@router.get("/{job_id}")
async def job_status(job_id: str, client_id: str = Depends(require_client)):
    return _job_or_404(get_store(), job_id)


@router.get("/{job_id}/act/{activiteit}/ronde/{ronde}")
async def ronde_analyse(job_id: str, activiteit: str, ronde: int, client_id: str = Depends(require_client)):
    if activiteit not in ("2", "3"):
        raise HTTPException(status_code=400, detail="activiteit moet 2 of 3 zijn")
    data = get_store().lees_analyse(job_id, activiteit, ronde)
    if data is None:
        raise HTTPException(status_code=404, detail="Geen analyse voor deze ronde")
    return data


@router.post("/{job_id}/feedback", status_code=status.HTTP_202_ACCEPTED)
async def geef_feedback(job_id: str, feedback: Feedback, client_id: str = Depends(require_client)):
    store = get_store()
    job = _job_or_404(store, job_id)
    if job.state not in REVIEW_STATES:
        raise HTTPException(status_code=409, detail=f"Feedback alleen in review-state; nu: {job.state}")
    verwacht = "2" if job.state == JobState.wacht_review_act2 else "3"
    if feedback.activiteit != verwacht:
        raise HTTPException(status_code=400, detail=f"Feedback voor activiteit {verwacht} verwacht")
    schedule(get_engine().apply_feedback(job_id, feedback))
    return {"id": job_id, "state": job.state, "ronde": job.current_ronde}


@router.post("/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_analyse(job_id: str, client_id: str = Depends(require_client)):
    job = _job_or_404(get_store(), job_id)
    if job.state != JobState.fout:
        raise HTTPException(status_code=409, detail=f"Retry alleen vanuit fout; nu: {job.state}")
    schedule(get_engine().retry(job_id))
    return {"id": job_id, "state": "queued"}


@router.get("/{job_id}/rapport")
async def rapport(job_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    _job_or_404(store, job_id)
    pad = store.rapport_pad(job_id)
    if not pad.exists():
        raise HTTPException(status_code=409, detail="Rapport nog niet gereed")
    return json.loads(pad.read_text(encoding="utf-8"))


@router.get("/{job_id}/rapport.md", response_class=PlainTextResponse)
async def rapport_md(job_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    _job_or_404(store, job_id)
    pad = store.rapport_pad(job_id)
    if not pad.exists():
        raise HTTPException(status_code=409, detail="Rapport nog niet gereed")
    from ..markdown import rapport_naar_markdown

    return rapport_naar_markdown(json.loads(pad.read_text(encoding="utf-8")))
