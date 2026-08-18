"""
GesprekStore — persistentie voor het gesprekken-domein (chatgeschiedenis van de werkplek).

Zelfde SQLAlchemy-Core-stijl als `annotatie_store.py` op dezelfde engine (`db.get_engine()`), met een
eigen tabelset (`gesprekken` + `gesprek_berichten`). Per-gebruiker gescopet (`user_id`). De berichten
staan als aparte, geordende rijen; de heterogene beurt-payload zit in de JSON-kolom `inhoud`. Tijd komt
uit Python (`db.utcnow`) zodat de queries portable blijven (SQLite-tests).
"""
from __future__ import annotations

from sqlalchemy import delete, func, insert, select, update

from . import db
from .gesprek_contracts import Bericht, BerichtInvoer, Gesprek, GesprekSamenvatting


def _bericht_uit_row(row) -> Bericht:
    d = row._mapping
    inhoud = d["inhoud"] or {}
    return Bericht(
        id=d["id"],
        rol=d["rol"],
        tekst=inhoud.get("tekst", ""),
        denk=inhoud.get("denk", ""),
        bronnen=inhoud.get("bronnen", []) or [],
        annotatie_slug=inhoud.get("annotatie_slug", ""),
        annotatie_titel=inhoud.get("annotatie_titel", ""),
        ontbrekend=inhoud.get("ontbrekend", []) or [],
        created=db.aware(d["created"]),
    )


def _inhoud(inv: BerichtInvoer | Bericht) -> dict:
    """De heterogene beurt-payload → de JSON-kolom (weglaten wat leeg is houdt de rij compact)."""
    inhoud: dict = {"tekst": inv.tekst}
    if inv.denk:
        inhoud["denk"] = inv.denk
    if inv.bronnen:
        inhoud["bronnen"] = inv.bronnen
    if inv.annotatie_slug:
        inhoud["annotatie_slug"] = inv.annotatie_slug
    if inv.annotatie_titel:
        inhoud["annotatie_titel"] = inv.annotatie_titel
    if inv.ontbrekend:
        inhoud["ontbrekend"] = inv.ontbrekend
    return inhoud


class GesprekStore:
    async def maak_gesprek(self, gesprek: Gesprek) -> None:
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            await conn.execute(insert(db.gesprekken).values(
                id=gesprek.id,
                user_id=gesprek.user_id,
                titel=gesprek.titel,
                created=now,
                updated=now,
            ))

    async def laad_gesprek(self, gesprek_id: str) -> Gesprek | None:
        async with db.get_engine().connect() as conn:
            row = (await conn.execute(
                select(db.gesprekken).where(db.gesprekken.c.id == gesprek_id)
            )).first()
            if row is None:
                return None
            berichten = (await conn.execute(
                select(db.gesprek_berichten)
                .where(db.gesprek_berichten.c.gesprek_id == gesprek_id)
                .order_by(db.gesprek_berichten.c.id)
            )).all()
        d = row._mapping
        return Gesprek(
            id=d["id"],
            user_id=d["user_id"],
            titel=d["titel"],
            berichten=[_bericht_uit_row(b) for b in berichten],
            created=db.aware(d["created"]),
            updated=db.aware(d["updated"]),
        )

    async def lijst_samenvattingen(
        self, user_id: str, limit: int = 100, offset: int = 0
    ) -> list[GesprekSamenvatting]:
        aantal = func.count(db.gesprek_berichten.c.id).label("aantal")
        async with db.get_engine().connect() as conn:
            rows = (await conn.execute(
                select(db.gesprekken, aantal)
                .select_from(db.gesprekken.outerjoin(
                    db.gesprek_berichten,
                    db.gesprekken.c.id == db.gesprek_berichten.c.gesprek_id,
                ))
                .where(db.gesprekken.c.user_id == user_id)
                .group_by(db.gesprekken.c.id)
                .order_by(db.gesprekken.c.updated.desc())
                .limit(limit).offset(offset)
            )).all()
        return [
            GesprekSamenvatting(
                id=r._mapping["id"],
                titel=r._mapping["titel"],
                aantal_berichten=r._mapping["aantal"],
                updated=db.aware(r._mapping["updated"]),
            )
            for r in rows
        ]

    async def voeg_bericht_toe(self, gesprek_id: str, inv: BerichtInvoer) -> Bericht:
        now = db.utcnow()
        async with db.get_engine().begin() as conn:
            result = await conn.execute(insert(db.gesprek_berichten).values(
                gesprek_id=gesprek_id,
                rol=inv.rol.value,
                inhoud=_inhoud(inv),
                created=now,
            ))
            # Bump het gesprek zodat de sidebar-sortering (updated desc) meeloopt.
            await conn.execute(
                update(db.gesprekken)
                .where(db.gesprekken.c.id == gesprek_id)
                .values(updated=now)
            )
            nieuw_id = result.inserted_primary_key[0] if result.inserted_primary_key else None
        return Bericht(
            id=nieuw_id, rol=inv.rol, tekst=inv.tekst, denk=inv.denk, bronnen=inv.bronnen,
            annotatie_slug=inv.annotatie_slug, annotatie_titel=inv.annotatie_titel,
            ontbrekend=inv.ontbrekend, created=db.aware(now),
        )

    async def hernoem_gesprek(self, gesprek_id: str, titel: str) -> None:
        async with db.get_engine().begin() as conn:
            await conn.execute(
                update(db.gesprekken)
                .where(db.gesprekken.c.id == gesprek_id)
                .values(titel=titel, updated=db.utcnow())
            )

    async def verwijder_gesprek(self, gesprek_id: str) -> None:
        async with db.get_engine().begin() as conn:
            await conn.execute(
                delete(db.gesprek_berichten).where(db.gesprek_berichten.c.gesprek_id == gesprek_id)
            )
            await conn.execute(delete(db.gesprekken).where(db.gesprekken.c.id == gesprek_id))
