"""Persistente opslag van analyses in SQLite.

Vervangt de in-memory dict uit de MVP. Analyses overleven nu herstarts.

Dataflow:
- save_analyse() ontvangt een dict met activiteit_2/3 als dict (van model_dump(mode='json'))
  of als Pydantic model. Beide worden correct naar JSON geserialiseerd.
- load_analyse() leest JSON uit de DB en retourneert dicts die direct gebruikt kunnen
  worden met Activiteit2Data(**data) etc.
"""

import json
import sqlite3
from typing import Optional

from app.config import settings


def _db_path():
    """Haal het database pad vanuit settings."""
    from pathlib import Path
    return Path(settings.database_path)


def _get_db() -> sqlite3.Connection:
    db_path = _db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_tables():
    """Zorg dat de analyses-tabel bestaat (idempotent)."""
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS analyses (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            wet TEXT NOT NULL,
            bwb_id TEXT NOT NULL,
            artikel TEXT NOT NULL,
            versiedatum TEXT DEFAULT '',
            bronreferentie TEXT DEFAULT '',
            sectie TEXT DEFAULT '',
            pad TEXT DEFAULT '',
            activiteit_2_json TEXT DEFAULT '',
            activiteit_3_json TEXT DEFAULT '',
            review_feedback_2 TEXT DEFAULT '',
            review_feedback_3 TEXT DEFAULT '',
            rapport_md TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
    """)
    conn.commit()
    conn.close()


def _serialize(data) -> str:
    """Serialiseer data naar JSON string.

    Ondersteunt:
    - Pydantic v2 modellen (via model_dump(mode='json'))
    - Gewone dicts/lists/strings/getallen

    Belangrijk: Pydantic modellen worden eerst omgezet naar dicts met
    model_dump(mode='json'), en dan wordt de hele structuur in 1 keer
    met json.dumps geserialiseerd. Dit voorkomt dubbele serialisatie
    van geneste lijsten.
    """
    if data is None:
        return ""

    # Pydantic v2 model — converteer naar dict, dan serializeer
    if hasattr(data, "model_dump"):
        return json.dumps(data.model_dump(mode="json"), ensure_ascii=False)

    # Gewone Python types — serializeer direct
    return json.dumps(data, ensure_ascii=False)


def save_analyse(analyse: dict) -> None:
    """Sla of update een analyse in de database.

    activiteit_2 en activiteit_3 worden altijd correct geserialiseerd,
    ongeacht of ze Pydantic modellen of dicts zijn.
    """
    conn = _get_db()
    try:
        a2_json = _serialize(analyse.get("activiteit_2"))
        a3_json = _serialize(analyse.get("activiteit_3"))

        existing = conn.execute(
            "SELECT id FROM analyses WHERE id = ?", (analyse["id"],)
        ).fetchone()

        if existing:
            conn.execute("""
                UPDATE analyses SET
                    status = ?, wet = ?, bwb_id = ?, artikel = ?,
                    versiedatum = ?, bronreferentie = ?, sectie = ?, pad = ?,
                    activiteit_2_json = ?, activiteit_3_json = ?,
                    review_feedback_2 = ?, review_feedback_3 = ?,
                    rapport_md = ?, updated_at = datetime('now')
                WHERE id = ? AND user_id = ?
            """, (
                analyse["status"], analyse["wet"], analyse["bwb_id"], analyse["artikel"],
                analyse.get("versiedatum", ""), analyse.get("bronreferentie", ""),
                analyse.get("sectie", ""), analyse.get("pad", ""),
                a2_json, a3_json,
                analyse.get("review_feedback_2", ""), analyse.get("review_feedback_3", ""),
                analyse.get("rapport_md", ""),
                analyse["id"], analyse["user_id"],
            ))
        else:
            conn.execute("""
                INSERT INTO analyses (
                    id, user_id, status, wet, bwb_id, artikel,
                    versiedatum, bronreferentie, sectie, pad,
                    activiteit_2_json, activiteit_3_json,
                    review_feedback_2, review_feedback_3, rapport_md
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                analyse["id"], analyse["user_id"], analyse["status"],
                analyse["wet"], analyse["bwb_id"], analyse["artikel"],
                analyse.get("versiedatum", ""), analyse.get("bronreferentie", ""),
                analyse.get("sectie", ""), analyse.get("pad", ""),
                a2_json, a3_json,
                analyse.get("review_feedback_2", ""), analyse.get("review_feedback_3", ""),
                analyse.get("rapport_md", ""),
            ))

        conn.commit()
    finally:
        conn.close()


def load_analyse(analyse_id: str, user_id: str) -> Optional[dict]:
    """Haal een analyse op uit de database.

    Retourneert dicts die direct gebruikt kunnen worden met
    Activiteit2Data(**data) etc.
    """
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT * FROM analyses WHERE id = ? AND user_id = ?",
            (analyse_id, user_id),
        ).fetchone()
        if row is None:
            return None

        a2 = json.loads(row["activiteit_2_json"]) if row["activiteit_2_json"] else None
        a3 = json.loads(row["activiteit_3_json"]) if row["activiteit_3_json"] else None

        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "status": row["status"],
            "wet": row["wet"],
            "bwb_id": row["bwb_id"],
            "artikel": row["artikel"],
            "versiedatum": row["versiedatum"],
            "bronreferentie": row["bronreferentie"],
            "sectie": row["sectie"],
            "pad": row["pad"],
            "activiteit_2": a2,
            "activiteit_3": a3,
            "review_feedback_2": row["review_feedback_2"],
            "review_feedback_3": row["review_feedback_3"],
            "rapport_md": row["rapport_md"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
    finally:
        conn.close()


def list_analyses(user_id: str, limit: int = 50) -> list[dict]:
    """Lijst van analyses voor een gebruiker."""
    conn = _get_db()
    try:
        rows = conn.execute(
            """SELECT id, status, wet, artikel, created_at, updated_at
               FROM analyses WHERE user_id = ?
               ORDER BY updated_at DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_analyse(analyse_id: str, user_id: str) -> bool:
    """Verwijder een analyse. Retourneert True als iets verwijderd is."""
    conn = _get_db()
    try:
        cursor = conn.execute(
            "DELETE FROM analyses WHERE id = ? AND user_id = ?",
            (analyse_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()
