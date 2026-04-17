"""
SQLite session persistence via aiosqlite.

Schema (created on first connection):
  sessions, messages, documents, chunks, chunks_fts (FTS5),
  definitions, cross_refs, artifacts, agent_runs
"""

from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

import aiosqlite

DB_PATH = "deep_reading.db"

# ─── Schema ──────────────────────────────────────────────────────────────────


_db_initialised = False

_DDL_STATEMENTS = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA foreign_keys=ON",
    """CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        created_at  TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        token_usage INTEGER,
        created_at  TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS documents (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        filename    TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS chunks (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        idx         INTEGER NOT NULL,
        content     TEXT NOT NULL,
        metadata    TEXT,
        section_id  TEXT,
        page        INTEGER
    )""",
    """CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
        USING fts5(content, content=chunks, content_rowid=rowid, tokenize="unicode61")""",
    """CREATE TRIGGER IF NOT EXISTS chunks_ai
        AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
        END""",
    """CREATE TRIGGER IF NOT EXISTS chunks_ad
        AFTER DELETE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content)
                VALUES ('delete', old.rowid, old.content);
        END""",
    """CREATE TRIGGER IF NOT EXISTS chunks_au
        AFTER UPDATE ON chunks BEGIN
            INSERT INTO chunks_fts(chunks_fts, rowid, content)
                VALUES ('delete', old.rowid, old.content);
            INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
        END""",
    """CREATE TABLE IF NOT EXISTS definitions (
        id              TEXT PRIMARY KEY,
        document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        term            TEXT NOT NULL,
        definition      TEXT NOT NULL,
        source_chunk_id TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS cross_refs (
        id              TEXT PRIMARY KEY,
        document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        from_chunk_id   TEXT NOT NULL,
        to_section_id   TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS artifacts (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        content         TEXT NOT NULL,
        mime_type       TEXT NOT NULL DEFAULT 'text/markdown',
        citations_json  TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS agent_runs (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        parent_agent_id TEXT,
        role            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'running',
        tokens_in       INTEGER NOT NULL DEFAULT 0,
        tokens_out      INTEGER NOT NULL DEFAULT 0
    )""",
]


async def _init_db(db: aiosqlite.Connection) -> None:
    global _db_initialised
    if _db_initialised:
        return
    for stmt in _DDL_STATEMENTS:
        await db.execute(stmt)
    await db.commit()
    _db_initialised = True


@asynccontextmanager
async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """Open (and initialise) the SQLite database as an async context manager.

    Usage:
        async with get_db() as db:
            ...

    Note: do NOT write `async with await get_db()` — aiosqlite's Connection
    starts its worker thread on await, and async-with would start it again.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await _init_db(db)
        yield db


# ─── Sessions ────────────────────────────────────────────────────────────────

async def create_session(title: Optional[str] = None) -> dict:
    sid = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO sessions (id, title, created_at) VALUES (?, ?, ?)",
            (sid, title, now),
        )
        await db.commit()
    return {"id": sid, "title": title, "created_at": now}


async def get_session(session_id: str) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cursor.fetchone()
    return dict(row) if row else None


async def list_sessions() -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM sessions ORDER BY created_at DESC"
        )
    return [dict(r) for r in rows]


# ─── Messages ────────────────────────────────────────────────────────────────

async def add_message(
    session_id: str, role: str, content: str, token_usage: Optional[int] = None
) -> dict:
    mid = str(uuid.uuid4())
    now = _now()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO messages (id, session_id, role, content, token_usage, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (mid, session_id, role, content, token_usage, now),
        )
        await db.commit()
    return {
        "id": mid,
        "session_id": session_id,
        "role": role,
        "content": content,
        "token_usage": token_usage,
        "created_at": now,
    }


async def get_messages(session_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at",
            (session_id,),
        )
    return [dict(r) for r in rows]


# ─── Documents / chunks ──────────────────────────────────────────────────────

async def create_document(session_id: str, filename: str) -> str:
    did = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO documents (id, session_id, filename, chunk_count) VALUES (?, ?, ?, 0)",
            (did, session_id, filename),
        )
        await db.commit()
    return did


async def insert_chunk(
    document_id: str,
    idx: int,
    content: str,
    metadata: Optional[dict] = None,
    section_id: Optional[str] = None,
    page: Optional[int] = None,
) -> str:
    cid = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO chunks (id, document_id, idx, content, metadata, section_id, page) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                cid,
                document_id,
                idx,
                content,
                json.dumps(metadata) if metadata else None,
                section_id,
                page,
            ),
        )
        await db.execute(
            "UPDATE documents SET chunk_count = chunk_count + 1 WHERE id = ?",
            (document_id,),
        )
        await db.commit()
    return cid


async def get_chunk(chunk_id: str) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM chunks WHERE id = ?", (chunk_id,))
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_chunks_for_document(document_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM chunks WHERE document_id = ? ORDER BY idx", (document_id,)
        )
    return [dict(r) for r in rows]


async def search_chunks(document_id: str, query: str, limit: int = 10) -> list[dict]:
    """FTS5 keyword search within a single document's chunks."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """
            SELECT c.id, c.document_id, c.idx, c.content, c.section_id, c.page,
                   bm25(chunks_fts) AS score
            FROM chunks_fts
            JOIN chunks c ON chunks_fts.rowid = c.rowid
            WHERE chunks_fts MATCH ?
              AND c.document_id = ?
            ORDER BY score
            LIMIT ?
            """,
            (query, document_id, limit),
        )
    return [dict(r) for r in rows]


async def get_chunk_by_section(document_id: str, section_id: str) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM chunks WHERE document_id = ? AND section_id = ? LIMIT 1",
            (document_id, section_id),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


# ─── Definitions ─────────────────────────────────────────────────────────────

async def insert_definition(
    document_id: str, term: str, definition: str, source_chunk_id: str
) -> str:
    did = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO definitions (id, document_id, term, definition, source_chunk_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (did, document_id, term, definition, source_chunk_id),
        )
        await db.commit()
    return did


async def lookup_definition(document_id: str, term: str) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM definitions WHERE document_id = ? AND LOWER(term) = LOWER(?) LIMIT 1",
            (document_id, term),
        )
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_definitions(document_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM definitions WHERE document_id = ?", (document_id,)
        )
    return [dict(r) for r in rows]


# ─── Cross-references ────────────────────────────────────────────────────────

async def insert_cross_ref(
    document_id: str, from_chunk_id: str, to_section_id: str
) -> str:
    rid = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO cross_refs (id, document_id, from_chunk_id, to_section_id) "
            "VALUES (?, ?, ?, ?)",
            (rid, document_id, from_chunk_id, to_section_id),
        )
        await db.commit()
    return rid


async def get_cross_refs(document_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM cross_refs WHERE document_id = ?", (document_id,)
        )
    return [dict(r) for r in rows]


# ─── Artifacts ───────────────────────────────────────────────────────────────

async def create_artifact(
    session_id: str,
    name: str,
    content: str,
    mime_type: str = "text/markdown",
    citations: Optional[list] = None,
) -> str:
    aid = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO artifacts (id, session_id, name, content, mime_type, citations_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                aid,
                session_id,
                name,
                content,
                mime_type,
                json.dumps(citations) if citations else None,
            ),
        )
        await db.commit()
    return aid


async def get_artifact(artifact_id: str) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
        row = await cursor.fetchone()
    return dict(row) if row else None


async def get_artifacts(session_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM artifacts WHERE session_id = ?", (session_id,)
        )
    return [dict(r) for r in rows]


# ─── Agent runs ──────────────────────────────────────────────────────────────

async def create_agent_run(
    session_id: str, role: str, parent_agent_id: Optional[str] = None
) -> str:
    rid = str(uuid.uuid4())
    async with get_db() as db:
        await db.execute(
            "INSERT INTO agent_runs (id, session_id, parent_agent_id, role, status) "
            "VALUES (?, ?, ?, ?, 'running')",
            (rid, session_id, parent_agent_id, role),
        )
        await db.commit()
    return rid


async def finish_agent_run(
    run_id: str, tokens_in: int, tokens_out: int, status: str = "done"
) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE agent_runs SET status = ?, tokens_in = ?, tokens_out = ? WHERE id = ?",
            (status, tokens_in, tokens_out, run_id),
        )
        await db.commit()


async def get_documents(session_id: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM documents WHERE session_id = ?", (session_id,)
        )
    return [dict(r) for r in rows]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
