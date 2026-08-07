"""
AnnotatieStore — persistentie voor het annotatie-domein (los van de analyse-`JobStore`).

Zelfde SQLAlchemy-Core-stijl als `postgres_store.py` op dezelfde engine (`db.get_engine()`), maar een
eigen, verse tabelset. Het document draagt de HUIDIGE elementen-staat (JSON); `annotatie_audit` is de
append-only geschiedenis (alleen inserts). Tijd komt uit Python (`db.utcnow`) zodat de queries portable
blijven (SQLite-tests).
"""
from __future__ import annotations

from typing import Callable

from sqlalchemy import delete, insert, select, update

from . import db
from .annotatie_contracts import AnnotatieDocument, AnnotatieElement, AuditRecord

# Sentinel: het document bestaat (en is van de client) maar het gevraagde element niet.
GEEN_ELEMENT = object()


def _naar_document(row) -> AnnotatieDocument:
    d = row._mapping
    return AnnotatieDocument(
        slug=d["slug"],
        user_id=d["user_id"] or "",   # legacy-rijen (vóór de migratie) hebben NULL → ""
        client_id=d["client_id"],
        werkgebied=d["werkgebied"],
        bwbId=d["bwbId"],
        artikel=d["artikel"],
        lid=d["lid"],
        status=d["status"],
        elementen=[AnnotatieElement.model_validate(e) for e in (d["elementen"] or [])],
        created=db.aware(d["created"]),
        updated=db.aware(d["updated"]),
    )


class AnnotatieStore:
    async def maak_document(self, doc: AnnotatieDocument) -> None:
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            await conn.execute(insert(db.annotatie_documenten).values(
                slug=doc.slug,
                user_id=doc.user_id,
                client_id=doc.client_id,
                werkgebied=doc.werkgebied,
                bwbId=doc.bwbId,
                artikel=doc.artikel,
                lid=doc.lid or "",
                status=doc.status.value,
                elementen=[e.model_dump(mode="json") for e in doc.elementen],
                created=now,
                updated=now,
            ))

    async def laad_document(self, slug: str) -> AnnotatieDocument | None:
        async with db.get_engine().connect() as conn:
            row = (await conn.execute(
                select(db.annotatie_documenten).where(db.annotatie_documenten.c.slug == slug)
            )).first()
        return _naar_document(row) if row else None

    async def lijst_documenten(self, user_id: str, limit: int = 50, offset: int = 0) -> list[AnnotatieDocument]:
        async with db.get_engine().connect() as conn:
            rows = (await conn.execute(
                select(db.annotatie_documenten)
                .where(db.annotatie_documenten.c.user_id == user_id)
                .order_by(db.annotatie_documenten.c.updated.desc())
                .limit(limit).offset(offset)
            )).all()
        return [_naar_document(r) for r in rows]

    async def vervang_elementen(self, slug: str, elementen: list[AnnotatieElement]) -> None:
        async with db.get_engine().begin() as conn:
            await conn.execute(
                update(db.annotatie_documenten)
                .where(db.annotatie_documenten.c.slug == slug)
                .values(elementen=[e.model_dump(mode="json") for e in elementen], updated=db.utcnow())
            )

    async def beslis_op_element(
        self,
        slug: str,
        user_id: str,
        element_id: str,
        toepassen: Callable[[AnnotatieElement], None],
    ) -> AnnotatieDocument | None | object:
        """Pas een human-decision ATOMAIR toe op één element: laad het document met een row-lock
        (`with_for_update`), toets eigenaarschap, muteer het element via `toepassen` en schrijf de
        volledige array in DEZELFDE transactie weg. Zo kunnen twee gelijktijdige besluiten op
        verschillende elementen elkaar niet meer overschrijven (lost update + audit-divergentie).

        Retourneert het bijgewerkte document, `None` (onbekend/niet-eigenaar → 404) of `GEEN_ELEMENT`
        (element bestaat niet → 404). `toepassen` muteert het element in-place (en kan de diff/lifecycle
        zetten). Op SQLite is `with_for_update` een no-op maar serialiseert de transactie de write.
        """
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            row = (await conn.execute(
                select(db.annotatie_documenten)
                .where(db.annotatie_documenten.c.slug == slug)
                .with_for_update()
            )).first()
            if row is None:
                return None
            doc = _naar_document(row)
            if doc.user_id != user_id:
                return None
            el = next((x for x in doc.elementen if x.id == element_id), None)
            if el is None:
                return GEEN_ELEMENT
            toepassen(el)
            await conn.execute(
                update(db.annotatie_documenten)
                .where(db.annotatie_documenten.c.slug == slug)
                .values(elementen=[e.model_dump(mode="json") for e in doc.elementen], updated=now)
            )
        doc.updated = now
        return doc

    async def zet_status(self, slug: str, status: str) -> None:
        async with db.get_engine().begin() as conn:
            await conn.execute(
                update(db.annotatie_documenten)
                .where(db.annotatie_documenten.c.slug == slug)
                .values(status=status, updated=db.utcnow())
            )

    async def verwijder_document(self, slug: str) -> None:
        async with db.get_engine().begin() as conn:
            await conn.execute(delete(db.annotatie_audit).where(db.annotatie_audit.c.document_slug == slug))
            await conn.execute(delete(db.annotatie_documenten).where(db.annotatie_documenten.c.slug == slug))

    async def schrijf_audit(
        self, slug: str, client_id: str, actor: str, actie: str,
        element_id: str | None = None, detail: dict | None = None,
    ) -> None:
        """Append-only: voegt één auditregel toe (nooit update/delete)."""
        async with db.get_engine().begin() as conn:
            await conn.execute(insert(db.annotatie_audit).values(
                document_slug=slug, client_id=client_id, actor=actor, actie=actie,
                element_id=element_id, detail=detail or {}, tijdstip=db.utcnow(),
            ))

    async def lees_audit(self, slug: str) -> list[AuditRecord]:
        async with db.get_engine().connect() as conn:
            rows = (await conn.execute(
                select(db.annotatie_audit)
                .where(db.annotatie_audit.c.document_slug == slug)
                .order_by(db.annotatie_audit.c.id)
            )).all()
        return [
            AuditRecord(
                id=r._mapping["id"], actor=r._mapping["actor"], actie=r._mapping["actie"],
                element_id=r._mapping["element_id"], detail=r._mapping["detail"] or {},
                tijdstip=db.aware(r._mapping["tijdstip"]),
            )
            for r in rows
        ]
