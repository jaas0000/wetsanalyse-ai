"""Service-laag voor gebruikersfeedback.

Analisten en beheerders sturen feedback vanuit de webapp; beheerders lezen de ingezonden
feedback via /v1/admin/feedback. Elke rij is onwijzigbaar (append-only).
"""

from __future__ import annotations

from sqlalchemy import insert, select

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
