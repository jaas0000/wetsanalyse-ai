"""Project-endpoints — CRUD + SSE voor real-time state-updates.

POST /projects  — maak project aan en start analyse (202)
GET  /projects  — lijst alle projecten (beknopt)
GET  /projects/{id}  — volledig project-object
DELETE /projects/{id}  — verwijder (alleen terminal state, anders 409)
POST /projects/{id}/feedback  — review-feedback
POST /projects/{id}/retry  — herstart vanuit fout
GET  /projects/{id}/rapport  — rapport JSON
GET  /projects/{id}/rapport.md  — rapport Markdown
GET  /projects/{id}/ronde/{act}/{n}  — analyse-JSON van één ronde
GET  /projects/{id}/events  — SSE state-updates (max 10 min)
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse, StreamingResponse

from ..auth import require_client
from ..contracts import Feedback, JobState, REVIEW_STATES, TERMINAL_STATES, StartRequest
from ..deps import get_engine, get_store, schedule
from ..mongo_store import IdConflict

router = APIRouter(prefix="/projects", tags=["projects"])


async def _project_or_404(store, project_id: str, client_id: str):
    """Laadt het project en dwingt eigenaarschap af. 404 (niet 403) bij mismatch, zodat
    het bestaan van andermans projecten niet lekt."""
    p = await store.load_project(project_id)
    if p is None or p.client_id != client_id:
        raise HTTPException(status_code=404, detail=f"Onbekend project: {project_id}")
    return p


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def maak_project(req: StartRequest, client_id: str = Depends(require_client)):
    try:
        engine = get_engine()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Engine niet beschikbaar: {e}")
    try:
        project = await engine.create_project(req, client_id)
    except IdConflict as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    schedule(engine.run_initial(project.slug))
    return {"id": project.slug, "naam": project.naam, "state": project.state}


@router.get("")
async def lijst_projecten(client_id: str = Depends(require_client)):
    projects = await get_store().list_projects(client_id)
    return [
        {
            "id": p.slug,
            "naam": p.naam,
            "state": p.state,
            "bwbId": p.bwbId,
            "artikel": p.artikel,
            "updated": p.updated.isoformat(),
        }
        for p in projects
    ]


@router.get("/{project_id}")
async def project_detail(project_id: str, client_id: str = Depends(require_client)):
    p = await _project_or_404(get_store(), project_id, client_id)
    return p.to_job()


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def verwijder_project(project_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    p = await _project_or_404(store, project_id, client_id)
    if p.state not in TERMINAL_STATES:
        raise HTTPException(
            status_code=409,
            detail=f"Kan alleen terminal projecten verwijderen; staat nu op: {p.state}",
        )
    await store.delete_project(project_id)


@router.post("/{project_id}/feedback", status_code=status.HTTP_202_ACCEPTED)
async def geef_feedback(project_id: str, feedback: Feedback, client_id: str = Depends(require_client)):
    store = get_store()
    p = await _project_or_404(store, project_id, client_id)
    job = p.to_job()
    if job.state not in REVIEW_STATES:
        raise HTTPException(status_code=409, detail=f"Feedback alleen in review-state; nu: {job.state}")
    verwacht = "2" if job.state == JobState.wacht_review_act2 else "3"
    if feedback.activiteit != verwacht:
        raise HTTPException(status_code=400, detail=f"Feedback voor activiteit {verwacht} verwacht")
    schedule(get_engine().apply_feedback(project_id, feedback))
    return {"id": project_id, "state": job.state, "ronde": job.current_ronde}


@router.post("/{project_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_project(project_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    p = await _project_or_404(store, project_id, client_id)
    if p.state != JobState.fout:
        raise HTTPException(status_code=409, detail=f"Retry alleen vanuit fout; nu: {p.state}")
    schedule(get_engine().retry(project_id))
    return {"id": project_id, "state": "queued"}


@router.get("/{project_id}/rapport")
async def project_rapport(project_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    await _project_or_404(store, project_id, client_id)
    data = await store.lees_rapport(project_id)
    if data is None:
        raise HTTPException(status_code=409, detail="Rapport nog niet gereed")
    return data


@router.get("/{project_id}/rapport.md", response_class=PlainTextResponse)
async def project_rapport_md(project_id: str, client_id: str = Depends(require_client)):
    store = get_store()
    await _project_or_404(store, project_id, client_id)
    data = await store.lees_rapport(project_id)
    if data is None:
        raise HTTPException(status_code=409, detail="Rapport nog niet gereed")
    from ..markdown import rapport_naar_markdown
    return rapport_naar_markdown(data)


@router.get("/{project_id}/ronde/{activiteit}/{ronde}")
async def project_ronde(
    project_id: str, activiteit: str, ronde: int, client_id: str = Depends(require_client)
):
    if activiteit not in ("2", "3"):
        raise HTTPException(status_code=400, detail="activiteit moet 2 of 3 zijn")
    store = get_store()
    await _project_or_404(store, project_id, client_id)
    data = await store.lees_analyse(project_id, activiteit, ronde)
    if data is None:
        raise HTTPException(status_code=404, detail="Geen analyse voor deze ronde")
    return data


@router.get("/{project_id}/events")
async def project_events(project_id: str, client_id: str = Depends(require_client)):
    """SSE — stuurt state-updates totdat het project klaar of in fout is (max 10 minuten)."""
    store = get_store()
    await _project_or_404(store, project_id, client_id)

    async def stream():
        seen = None
        for _ in range(120):
            p = await store.load_project(project_id)
            if p is None:
                yield "event: error\ndata: project niet gevonden\n\n"
                return
            current = {
                "state": p.state,
                "current_activiteit": p.current_activiteit,
                "current_ronde": p.current_ronde,
            }
            if current != seen:
                yield f"data: {json.dumps(current)}\n\n"
                seen = current
            if p.state in TERMINAL_STATES:
                yield "event: done\ndata: {}\n\n"
                return
            await asyncio.sleep(5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
