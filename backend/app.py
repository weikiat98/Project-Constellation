"""
FastAPI application — Constellation backend.

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
    SessionUpdate,
    TokenCountOut,
    TokenCountRequest,
)
from backend.orchestrator.compactor import WINDOW, _count_tokens_approx
from backend.orchestrator.event_bus import event_registry
from backend.orchestrator.lead import MODEL, run_lead
from backend.orchestrator.tools import LEAD_TOOLS
import anthropic
from backend.store.documents import DocumentStore
from backend.store.sessions import (
    add_message,
    create_session,
    delete_document,
    delete_messages_after,
    delete_session,
    document_referenced_by_message,
    get_artifact,
    get_artifacts,
    get_chunks_for_document,
    get_documents,
    get_messages,
    get_session,
    get_trace_events,
    list_sessions,
    next_trace_run_index,
    update_session,
)
from backend.extractors.definitions import extract_definitions
from backend.extractors.cross_refs import extract_cross_refs

app = FastAPI(title="Constellation", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_doc_store = DocumentStore()

# Per-session cancellation events. The Lead loop checks the event each
# iteration and exits early if it's set. The /cancel endpoint sets the event;
# the run task clears it on completion.
_cancel_events: dict[str, asyncio.Event] = {}


# ─── Sessions ────────────────────────────────────────────────────────────────

@app.post("/api/sessions", response_model=SessionOut, status_code=201)
async def create_session_endpoint(body: SessionCreate):
    return await create_session(body.title)


@app.get("/api/sessions", response_model=list[SessionOut])
async def list_sessions_endpoint():
    return await list_sessions()


@app.patch("/api/sessions/{session_id}", response_model=SessionOut)
async def patch_session_endpoint(session_id: str, body: SessionUpdate):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    updated = await update_session(
        session_id, title=body.title, pinned=body.pinned, audience=body.audience
    )
    return updated


@app.delete("/api/sessions/{session_id}", status_code=200)
async def delete_session_endpoint(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    ok = await delete_session(session_id)
    return {"deleted": ok}


@app.delete("/api/sessions/{session_id}/messages/after/{message_id}", status_code=200)
async def truncate_messages_endpoint(session_id: str, message_id: str):
    """Delete the given message and every message after it. Used by edit/retry."""
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    deleted = await delete_messages_after(session_id, message_id)
    return {"deleted": deleted}


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

    # Save to a temp file then ingest. The temp path is internal — we pass
    # the user's original filename separately so nothing downstream ever
    # surfaces the OS temp name.
    original_name = file.filename or "upload"
    suffix = Path(original_name).suffix or ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = await _doc_store.ingest(
            session_id, tmp_path, original_filename=original_name
        )
    finally:
        os.unlink(tmp_path)

    # Run extractors in background. Wrap each task so an exception doesn't
    # vanish into a "Task exception was never retrieved" warning, and verify
    # the document still exists at run time so a delete-during-extraction
    # doesn't insert orphan rows referencing a removed FK parent.
    from backend.store.sessions import get_chunks_for_document, document_exists

    chunks = await get_chunks_for_document(result["document_id"])
    document_id = result["document_id"]

    async def _safe_extract(extractor, name: str):
        try:
            if not await document_exists(document_id):
                return  # document was deleted before extraction ran
            await extractor(document_id, chunks)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "extractor %s failed for document %s: %s", name, document_id, exc
            )

    asyncio.create_task(_safe_extract(extract_definitions, "definitions"))
    asyncio.create_task(_safe_extract(extract_cross_refs, "cross_refs"))

    return DocumentOut(
        id=result["document_id"],
        session_id=session_id,
        filename=result["filename"],
        chunk_count=result["chunk_count"],
    )


@app.delete("/api/sessions/{session_id}/documents/{document_id}", status_code=200)
async def delete_document_endpoint(session_id: str, document_id: str):
    """Remove an uploaded document from a session.

    Refuses if the document is referenced by a persisted message — deleting it
    would leave stale chip references on past turns. Frontend can surface the
    409 as a "this document is attached to a previous message" message.
    """
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if await document_referenced_by_message(session_id, document_id):
        raise HTTPException(
            409,
            "Document is attached to a previous message and cannot be deleted. "
            "Delete the messages that reference it first, or start a new chat.",
        )
    ok = await delete_document(session_id, document_id)
    if not ok:
        raise HTTPException(404, "Document not found")
    return {"deleted": ok}


# ─── Messages / agent runs ───────────────────────────────────────────────────

def _derive_title(text: str, max_len: int = 60) -> str:
    """First line, trimmed to max_len chars with ellipsis if truncated."""
    first = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
    first = first.strip()
    if len(first) <= max_len:
        return first or "Untitled chat"
    return first[: max_len - 1].rstrip() + "…"


@app.post("/api/sessions/{session_id}/messages", response_model=MessageOut, status_code=202)
async def submit_message(session_id: str, body: MessageCreate):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Persist user message — record which documents the user attached to this
    # specific turn so chips re-render correctly after a page reload.
    user_msg = await add_message(
        session_id,
        "user",
        body.content,
        attached_document_ids=body.attached_document_ids or None,
    )

    # Auto-title: if this is the session's first user message and no title set.
    if not session.get("title"):
        existing = await get_messages(session_id)
        user_msgs = [m for m in existing if m["role"] == "user"]
        if len(user_msgs) == 1:
            await update_session(session_id, title=_derive_title(body.content))

    # Persist the audience on the session so refreshes see the user's last choice.
    if body.audience and body.audience != session.get("audience"):
        await update_session(session_id, audience=body.audience)

    # Get a LIVE SSE bus — replaces any closed-out bus from a prior run.
    bus = event_registry.ensure_live(session_id)
    run_index = await next_trace_run_index(session_id)
    bus.bind_persistence(session_id, run_index)

    # Mark the session as running so any client that lands on the page (or
    # comes back from another session) knows to re-attach the SSE stream.
    await update_session(session_id, last_run_state="running")

    # Fresh cancel event for this run. Replaces any prior event so a stale
    # set() from a previous run can't immediately abort the new one.
    cancel_event = asyncio.Event()
    _cancel_events[session_id] = cancel_event

    # Kick off agent run as a background task
    async def _run():
        final_state = "completed"
        try:
            await run_lead(
                session_id,
                body.content,
                bus,
                body.audience,
                cancel_event,
                body.attached_document_ids or None,
            )
            if cancel_event.is_set():
                final_state = "cancelled"
        except Exception as exc:
            final_state = "error"
            bus.publish("error", message=str(exc))
        finally:
            bus.close()
            event_registry.close(session_id)
            # Drop the cancel event so a later cancel can't accidentally
            # affect a future run.
            _cancel_events.pop(session_id, None)
            # Best-effort: record terminal state so re-mounted sessions see
            # `idle/completed/error/cancelled` instead of getting stuck in
            # `running`.
            try:
                await update_session(session_id, last_run_state=final_state)
            except Exception:
                pass

    asyncio.create_task(_run())

    return MessageOut(**user_msg)


@app.post("/api/sessions/{session_id}/cancel", status_code=200)
async def cancel_run(session_id: str):
    """Signal the in-flight Lead run to stop at its next iteration.

    The Lead loop checks the cancel event each iteration and emits a final
    message + run_complete before returning, so the SSE consumer terminates
    cleanly. Idempotent — calling on an idle session is a no-op.
    """
    event = _cancel_events.get(session_id)
    if event is None:
        return {"cancelled": False, "reason": "no run in flight"}
    event.set()
    return {"cancelled": True}


# ─── Agent trace history ─────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/trace")
async def get_trace(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    events = await get_trace_events(session_id)
    return {"events": events}


# ─── SSE stream ──────────────────────────────────────────────────────────────

@app.get("/api/sessions/{session_id}/stream")
async def stream_events(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # If no run is in flight, return a one-shot stream that closes immediately.
    # Without this, opening /stream against an idle session would block forever
    # on an empty queue — the consumer awaits an event that will never arrive,
    # holding the SSE connection open until the browser/server timeout fires.
    if session.get("last_run_state") != "running":
        async def _empty_stream():
            yield 'data: {"type": "run_complete", "final": ""}\n\n'

        return StreamingResponse(
            _empty_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

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


@app.post("/api/sessions/{session_id}/count_tokens", response_model=TokenCountOut)
async def count_tokens(session_id: str, body: TokenCountRequest):
    """
    Count the tokens the next turn will consume if the user sends `content` now.

    Mirrors what the Lead orchestrator assembles — system prompt, tool
    definitions, the ~50-chunk document index, persisted chat history, and the
    draft prompt — and calls Anthropic's free `count_tokens` endpoint.

    Accuracy note: the result is an estimate. The actual call may differ by a
    few tokens due to system-added tokens Anthropic inserts internally.
    """
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Build the doc index the Lead injects at the start of every run.
    # Filter to attached_document_ids when provided so the estimate matches
    # what `run_lead` actually sends to the model — see C3 in BUG_REPORT.md.
    docs = await get_documents(session_id)
    if body.attached_document_ids:
        attached_set = set(body.attached_document_ids)
        docs = [d for d in docs if d["id"] in attached_set]
    doc_context_parts: list[str] = []
    for doc in docs:
        chunks = await get_chunks_for_document(doc["id"])
        chunk_lines = []
        for c in chunks[:50]:
            section = f" [§{c['section_id']}]" if c.get("section_id") else ""
            page = f" p.{c['page']}" if c.get("page") else ""
            preview = c["content"][:120].replace("\n", " ")
            chunk_lines.append(f"  chunk_id={c['id']}{section}{page}: {preview}…")
        doc_context_parts.append(
            f"Document: {doc['filename']} ({doc['chunk_count']} chunks)\n"
            + "\n".join(chunk_lines)
        )
    doc_context = (
        "\n\n".join(doc_context_parts) if doc_context_parts else "No documents uploaded yet."
    )

    # Rebuild the message array: existing history + a synthetic new user turn.
    # Mirror run_lead exactly: only add the doc-index wrapper when documents
    # are present, otherwise pass the prompt verbatim. This keeps the
    # estimate aligned with the actual API call.
    history = await get_messages(session_id)
    base_messages = [
        {"role": m["role"], "content": m["content"]} for m in history
    ]

    if doc_context_parts:
        wrapped_template = "## Document Index\n{ctx}\n\n## User Question\n{q}"
        base_wrapped = wrapped_template.format(ctx=doc_context, q="")
        full_wrapped = wrapped_template.format(ctx=doc_context, q=body.content)
    else:
        base_wrapped = ""
        full_wrapped = body.content

    system_prompt_placeholder = (
        "You are the Lead Orchestrator of Constellation, a multi-agent document "
        "analysis assistant. [system prompt truncated for counting]"
    )

    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    async def _count(msgs: list[dict]) -> int:
        try:
            resp = await client.messages.count_tokens(
                model=MODEL,
                system=system_prompt_placeholder,
                tools=LEAD_TOOLS,
                messages=msgs,
            )
            return int(resp.input_tokens)
        except Exception:
            # Fall back to the in-house approximation so the UI never breaks.
            return _count_tokens_approx(msgs)

    base_msgs = base_messages + [{"role": "user", "content": base_wrapped}]
    full_msgs = base_messages + [{"role": "user", "content": full_wrapped}]

    base_total = await _count(base_msgs)
    full_total = base_total if not body.content else await _count(full_msgs)
    prompt_tokens = max(0, full_total - base_total)

    return TokenCountOut(
        prompt_tokens=prompt_tokens,
        base_tokens=base_total,
        total_tokens=full_total,
        window=WINDOW,
        percent=round(full_total / WINDOW * 100, 1),
    )


@app.post("/api/sessions/{session_id}/compact", status_code=200)
async def manual_compact(session_id: str):
    """Manually trigger Lead-context compaction (test/preview only).

    NOTE: This endpoint runs the compactor against the current persisted
    history but **does not persist the compacted result**. The next real
    run still loads full history via `get_messages` and re-compacts on its
    own threshold. The endpoint exists to let the UI surface a
    `compaction_done` event and confirm the compactor pipeline is healthy
    — it is not a way to durably shrink a session's context.
    """
    bus = event_registry.get_or_create(session_id)
    messages = await get_messages(session_id)
    history = [{"role": m["role"], "content": m["content"]} for m in messages]
    from backend.orchestrator.compactor import maybe_compact

    _, compacted = await maybe_compact(history, bus)
    return {
        "compacted": compacted,
        "persisted": False,
        "note": (
            "Compaction was run but not saved. Real runs trigger their own "
            "compaction automatically when context exceeds 85% of the window."
        ),
    }


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
    from backend.store.sessions import get_chunk, get_db
    chunk = await get_chunk(chunk_id)
    if not chunk:
        raise HTTPException(404, "Chunk not found")

    # Attach the user-facing document filename so the citation can render a
    # meaningful label (instead of an opaque hash).
    filename: Optional[str] = None
    doc_id = chunk.get("document_id")
    if doc_id:
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT original_filename, filename FROM documents WHERE id = ?",
                (doc_id,),
            )
            row = await cursor.fetchone()
        if row:
            filename = row["original_filename"] or row["filename"]

    return {
        "id": chunk["id"],
        "content": chunk["content"],
        "section_id": chunk.get("section_id"),
        "page": chunk.get("page"),
        "filename": filename,
    }
