"""Service-laag voor gebruikersfeedback.

Analisten en beheerders sturen feedback vanuit de webapp; beheerders lezen de ingezonden
feedback via /v1/admin/feedback. Elke rij is onwijzigbaar (append-only).
"""

from __future__ import annotations

from sqlalchemy import func, insert, select, update

from . import db


async def dien_in(
    client_id: str,
    userid: str,
    categorie: str,
    tekst: str,
    pagina: str | None,
) -> int:
    """Sla een feedbackitem op en geef het id terug."""
    nu = db.utcnow()
    async with db.get_engine().begin() as conn:
        result = await conn.execute(
            insert(db.user_feedback)
            .values(
                client_id=client_id,
                userid=userid,
                categorie=categorie,
                tekst=tekst.strip(),
                pagina=pagina,
                created=nu,
            )
            .returning(db.user_feedback.c.id)
        )
        return result.scalar_one()


async def ongelezen_feedback_aantal(admin_userid: str) -> int:
    """Aantal feedback-items ingediend nadat deze beheerder ze voor het laatst heeft gezien."""
    uf = db.user_feedback
    u = db.users
    gezien_subq = select(u.c.feedback_gezien_op).where(u.c.userid == admin_userid).scalar_subquery()
    stmt = (
        select(func.count())
        .select_from(uf)
        .where((gezien_subq.is_(None)) | (uf.c.created > gezien_subq))
    )
    async with db.get_engine().connect() as conn:
        result = await conn.scalar(stmt)
    return int(result or 0)


async def markeer_feedback_gezien(admin_userid: str) -> None:
    """Sla op dat deze beheerder de feedback tot nu toe gezien heeft."""
    async with db.get_engine().begin() as conn:
        await conn.execute(
            update(db.users)
            .where(db.users.c.userid == admin_userid)
            .values(feedback_gezien_op=db.utcnow())
        )


async def lijst_feedback(offset: int = 0, limit: int = 50) -> list[dict]:
    """Alle ingezonden feedback, nieuwste eerst (voor beheerders)."""
    stmt = (
        select(db.user_feedback)
        .order_by(db.user_feedback.c.created.desc())
        .offset(offset)
        .limit(limit)
    )
    async with db.get_engine().connect() as conn:
        rows = (await conn.execute(stmt)).mappings().all()
    return [
        {
            "id":        r["id"],
            "client_id": r["client_id"],
            "userid":    r["userid"],
            "categorie": r["categorie"],
            "tekst":     r["tekst"],
            "pagina":    r["pagina"],
            "created":   db.aware(r["created"]),
        }
        for r in rows
    ]
