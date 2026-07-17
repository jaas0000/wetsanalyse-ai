"""
Gespreksgeheugen: sla conversaties op in SQLite zodat de agent
eerdere berichten kan meenemen als context.

Elk gesprek heeft een conversation_id (UUID). De history is een
geordende lijst van {role, content}-berichten, precies zoals de
Anthropic Messages API dat verwacht.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any


def _db_path() -> Path:
    p = Path(os.environ.get("MEMORY_DB_PATH", "conversations.db"))
    if not p.is_absolute():
        # relatief aan de graph-qa-root (één niveau boven agent/)
        p = Path(__file__).parent.parent / p
    return p


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT    NOT NULL,
            role            TEXT    NOT NULL,
            content         TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_conv ON messages(conversation_id, id)"
    )
    conn.commit()
    return conn


def load_history(conversation_id: str, max_turns: int = 10) -> list[dict[str, Any]]:
    """Laad de laatste max_turns beurten van een gesprek, oudste eerst."""
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT role, content FROM messages
            WHERE conversation_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (conversation_id, max_turns * 2),  # *2: elke beurt = user + assistant
        ).fetchall()
        # rows zijn nieuwste-eerst; keer om naar oudste-eerst
        rows = list(reversed(rows))
        result = []
        for row in rows:
            content = row["content"]
            try:
                parsed = json.loads(content)
                result.append({"role": row["role"], "content": parsed})
            except (json.JSONDecodeError, TypeError):
                result.append({"role": row["role"], "content": content})
        return result
    finally:
        conn.close()


def save_turn(
    conversation_id: str,
    user_message: str,
    assistant_message: str,
) -> None:
    """Sla één vraag-antwoord-ronde op (alleen de eindtekst, geen tool-rondes)."""
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (conversation_id, "user", user_message),
        )
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (conversation_id, "assistant", assistant_message),
        )
        conn.commit()
    finally:
        conn.close()


def list_conversations(limit: int = 20) -> list[dict[str, Any]]:
    """Geef een lijst van recente gesprekken (voor debugging/beheer)."""
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT conversation_id,
                   COUNT(*) / 2  AS turns,
                   MIN(created_at) AS started,
                   MAX(created_at) AS last_active
            FROM messages
            GROUP BY conversation_id
            ORDER BY last_active DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
