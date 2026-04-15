"""
FastAPI application — deep-reading assistant backend.

Endpoints:
  POST /api/sessions                          Create session
  GET  /api/sessions                          List sessions
  GET  /api/sessions/{id}                     Session detail (history + artifacts)
  POST /api/sessions/{id}/documents           Upload document
  POST /api/sessions/{id}/messages            Submit user prompt (kicks off agent run)
  GET  /api/sessions/{id}/stream              SSE stream of agent events
  GET  /api/sessions/{id}/context             Lead token usage
  POST /api/sessions/{id}/compact             Manual compaction trigger
  GET  /api/artifacts/{id}                    Download artifact
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.models import (
    ArtifactOut,
    ContextUsageOut,
    DocumentOut,
    MessageCreate,
    MessageOut,
    SessionCreate,
    SessionDetail,
    SessionOut,
)
from backend.orchestrator.compactor import WINDOW, _count_tokens_approx
from backend.orchestrator.event_bus import event_registry
from backend.orchestrator.lead import run_lead
from backend.store.documents import DocumentStore
from backend.store.sessions import (
    add_message,
    create_session,
    get_artifact,
    get_artifacts,
    get_documents,
    get_messages,
    get_session,
    list_sessions,
)
from backend.extractors.definitions import extract_definitions
from backend.extractors.cross_refs import extract_cross_refs

app = FastAPI(title="Deep-Reading Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_doc_store = DocumentStore()

# Track per-session token usage (rough estimate from lead runs)
_session_tokens: dict[str, int] = {}


# ─── Sessions ────────────────────────────────────────────────────────────────

@app.post("/api/sessions", response_model=SessionOut, status_code=201)
async def create_session_endpoint(body: SessionCreate):
    return await create_session(body.title)


@app.get("/api/sessions", response_model=list[SessionOut])
async def list_sessions_endpoint():
    return await list_sessions()


@app.get("/api/sessions/{session_id}", response_model=SessionDetail)
async def get_session_endpoint(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    messages = await get_messages(session_id)
    documents = await get_documents(session_id)
    artifacts = await get_artifacts(session_id)
    return SessionDetail(
        session=SessionOut(**session),
        messages=[MessageOut(**m) for m in messages],
        documents=[DocumentOut(**d) for d in documents],
        artifacts=[ArtifactOut(**a) for a in artifacts],
    )


# ─── Documents ───────────────────────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(session_id: str, file: UploadFile = File(...)):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Save to a temp file then ingest
    suffix = Path(file.filename or "upload").suffix or ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = await _doc_store.ingest(session_id, tmp_path)
    finally:
        os.unlink(tmp_path)

    # Run extractors in background
    from backend.store.sessions import get_chunks_for_document

    chunks = await get_chunks_for_document(result["document_id"])
    asyncio.create_task(extract_definitions(result["document_id"], chunks))
    asyncio.create_task(extract_cross_refs(result["document_id"], chunks))

    return DocumentOut(
        id=result["document_id"],
        session_id=session_id,
        filename=result["filename"],
        chunk_count=result["chunk_count"],
    )


# ─── Messages / agent runs ───────────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/messages", response_model=MessageOut, status_code=202)
async def submit_message(session_id: str, body: MessageCreate):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Persist user message
    user_msg = await add_message(session_id, "user", body.content)

    # Get or create SSE bus for this session
    bus = event_registry.get_or_create(session_id)

    # Kick off agent run as a background task
    async def _run():
        try:
            await run_lead(session_id, body.content, bus, body.audience)
        except Exception as exc:
            bus.publish("error", message=str(exc))
        finally:
            bus.close()
            event_registry.close(session_id)

    asyncio.create_task(_run())

    return MessageOut(**user_msg)


# ─── SSE stream ──────────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/stream")
async def stream_events(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    bus = event_registry.get_or_create(session_id)

    return StreamingResponse(
        bus.consume(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Context meter ───────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/context", response_model=ContextUsageOut)
async def get_context(session_id: str):
    messages = await get_messages(session_id)
    tokens = _count_tokens_approx(
        [{"role": m["role"], "content": m["content"]} for m in messages]
    )
    return ContextUsageOut(
        tokens=tokens,
        window=WINDOW,
        percent=round(tokens / WINDOW * 100, 1),
    )


@app.post("/api/sessions/{session_id}/compact", status_code=200)
async def manual_compact(session_id: str):
    """Manually trigger Lead-context compaction (for testing/advanced use)."""
    bus = event_registry.get_or_create(session_id)
    messages = await get_messages(session_id)
    history = [{"role": m["role"], "content": m["content"]} for m in messages]
    from backend.orchestrator.compactor import maybe_compact

    _, compacted = await maybe_compact(history, bus)
    return {"compacted": compacted}


# ─── Artifacts ───────────────────────────────────────────────────────────────

@app.get("/api/artifacts/{artifact_id}", response_model=ArtifactOut)
async def get_artifact_endpoint(artifact_id: str):
    artifact = await get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    return ArtifactOut(**artifact)


# ─── Chunks (for SourceDrawer) ───────────────────────────────────────────────

@app.get("/api/chunks/{chunk_id}")
async def get_chunk_endpoint(chunk_id: str):
    from backend.store.sessions import get_chunk
    chunk = await get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(404, "Chunk not found")
    return {
        "id": chunk["id"],
        "content": chunk["content"],
        "section_id": chunk.get("section_id"),
        "page": chunk.get("page"),
    }
