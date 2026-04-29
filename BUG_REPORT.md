# Bug Report — Project Constellation

**Date:** 2026-04-29  
**Scope:** Full repository audit — backend orchestration, persistence, SSE streaming, UI state, shared utilities  
**Auditor:** Claude (Opus 4.7)

---

## Table of Contents

- [Critical](#critical)
- [High](#high)
- [Medium](#medium)
- [Low](#low)
- [Summary](#summary)

---

## Critical

### C1 — SQLite migrations short-circuited by stale `_db_initialised` flag

**File:** `backend/store/sessions.py:134-175`  
**Impact:** Every cascade delete silently fails; foreign key integrity disabled for all connections after the first.

```python
_db_initialised = False  # module-level

async def _init_db(db):
    global _db_initialised
    if _db_initialised:
        return  # early-out skips ALL migrations AND PRAGMA foreign_keys=ON
    ...
    _db_initialised = True
```

SQLite's `PRAGMA foreign_keys=ON` is **per-connection**, not persistent. The first connection applies it; every subsequent connection hits the `if _db_initialised: return` guard and returns immediately — never running the pragma. This silently disables the `ON DELETE CASCADE` on all tables (`sessions → messages`, `documents → chunks`, `artifacts`, `agent_runs`, `trace_events`, etc.), meaning `delete_session` and `delete_document` leave orphaned rows indefinitely.

**Fix:** Split `PRAGMA foreign_keys=ON` out of the `_db_initialised` guard and run it unconditionally on every connection. Keep the guard only for the DDL and migration block.

---

### C2 — `delete_messages_after` deletes by timestamp, not by ID, causing over-deletion

**File:** `backend/store/sessions.py:328-343`

```python
cursor = await db.execute(
    "DELETE FROM messages WHERE session_id = ? AND created_at >= ?",
    (session_id, pivot),
)
```

The pivot row's own `created_at` is matched by `>=` and deletion is purely time-based. If two messages share a timestamp (possible under WAL concurrency or test fixtures with a clock seed), all of them are deleted. There is no message-ID tiebreaker.

**Fix:** Use the pivot row's rowid for a stable ordering: `WHERE rowid >= (SELECT rowid FROM messages WHERE id = ?)`, or add an autoincrement ordering column and use that for deletion boundaries.

---

### C3 — `count_tokens` endpoint ignores `attached_document_ids` and diverges from actual Lead context

**File:** `backend/app.py:336-352`, `backend/orchestrator/lead.py:247-264`

The token-count endpoint loads all session documents unconditionally and injects a wrapper even when `doc_context_parts` is empty. The Lead's actual run path only adds the document-index wrapper when documents exist. On sessions with many documents where only a subset is attached per turn, the user-facing token estimate is inflated relative to what is actually billed.

**Fix:** Thread `attached_document_ids` through the count endpoint and `run_lead`, and filter the doc list to the attached subset in both places so the estimate matches the actual call.

---

### C4 — Background extractor tasks are fire-and-forget with no error handling and race with delete

**File:** `backend/app.py:166-171`

```python
asyncio.create_task(extract_definitions(result["document_id"], chunks))
asyncio.create_task(extract_cross_refs(result["document_id"], chunks))
```

Two issues:
1. **No exception handling.** If either coroutine raises, the task silently dies and the user sees no feedback. Re-uploading the same file also silently produces nothing.
2. **Race with delete.** If the user deletes the document (or session) before the tasks complete, the tasks attempt to insert definitions/cross-refs referencing a deleted FK parent. Without C1's FK enforcement, this inserts orphans; with it, the task crashes.

**Fix:** Wrap each `create_task` in an inner coroutine that catches and logs exceptions. Before inserting, verify the document still exists.

---

## High

### H1 — SSE `EventSource` can leak connections when `attachStream` is called multiple times

**File:** `frontend/app/sessions/[id]/page.tsx:313`

`stopRef.current = unsubscribe` overwrites the previous unsubscribe handle without calling it. Multiple code paths call `attachStream()` (mount, `handleSend`, `handleRetry`, `handleEdit`, handoff from `/home`) without first closing the previous `EventSource`. On rapid successive sends or retries, multiple parallel `EventSource` connections are opened to the same session.

**Fix:** First line of `attachStream`:

```ts
stopRef.current?.();
stopRef.current = null;
```

---

### H2 — SSE streaming is per-process; multi-worker deployments break

**File:** `backend/orchestrator/event_bus.py:129-157`, `backend/app.py:286-301`

`event_registry` is a module-level singleton `dict`. Running `uvicorn --workers=N` routes the message-submit POST and the SSE-stream GET to different workers, each with their own registry. The SSE worker has no bus and either hangs forever or returns an empty stream.

**Fix:** Document the single-worker constraint explicitly, or replace the in-process bus with an external pub/sub backend (e.g., Redis Streams) for production multi-worker deployments.

---

### H3 — Previous SSE connection is not closed before attaching a new one (corollary to H1)

**File:** `frontend/app/sessions/[id]/page.tsx:419`, `484`, `511`

All three of `handleSend`, `handleRetry`, and `handleEdit` call `attachStream()` directly without first stopping any existing stream. Combined with the overwrite in H1, each of these operations can add an unclosed `EventSource` to the browser's connection pool.

**Fix:** Same as H1 — call `stopRef.current?.()` at the top of `attachStream`.

---

### H4 — `useEffect` includes `audience` in deps, causing extra re-fetches on every audience toggle

**File:** `frontend/app/sessions/[id]/page.tsx:385`

The mount `useEffect` lists `audience` in its dependency array, but the effect body also calls `setAudience(...)` (on handoff or inference). Each `setAudience` call re-triggers the effect, causing an extra `api.getSession` round-trip and a re-check of `last_run_state` on every manual audience toggle by the user.

**Fix:** Remove `audience` from the dependency array. The audience value used inside the effect comes only from the initial mount or URL params, so it can safely be read from a ref or omitted.

---

### H5 — Stop button only closes the client-side SSE connection; the backend run keeps consuming tokens

**File:** `frontend/app/sessions/[id]/page.tsx:443-453`, `backend/app.py:251-268`

The Stop button calls `stopRef.current?.()`, which closes the `EventSource`. The backend `_run()` task continues iterating the 40-turn agentic loop, calling the Anthropic API and accumulating token charges until it either finishes naturally or hits the iteration limit. There is no cancel endpoint and no cancellation token passed into `run_lead`.

**Fix:** Add a `POST /api/sessions/{id}/cancel` endpoint that sets a cancellation flag. Thread a `cancelled: asyncio.Event` into `run_lead` and check it at the top of each loop iteration. Call the endpoint from `handleStop` before closing the EventSource.

---

### H6 — `mergeWithBanners` drops audience banners when the adjacent persisted message was deleted

**File:** `frontend/app/sessions/[id]/page.tsx:42-70`

Banners are keyed to the ID of the next persisted message. When that message is deleted (e.g., by retry truncation), the banner's `nextPersistedId` no longer appears in `serverMsgs`, so the banner is silently dropped from the merged result.

**Fix:** Anchor banners by count of preceding non-system messages rather than by exact next-message ID, so they survive truncation.

---

### H7 — Race in `runArtifactIds` — local mutable array shared across closures

**File:** `frontend/app/sessions/[id]/page.tsx:182-241`

```ts
const runArtifactIds: string[] = [];
setRunArtifactIds([]);
...
runArtifactIds.push(event.artifact_id);
setRunArtifactIds([...runArtifactIds]);
```

The local array is mutated in place and then spread into the React setter. If `attachStream` is called a second time (H1/H3), the new closure creates a fresh local array while the previous React state still holds the old one. Artifact cards can flicker or duplicate as the two closures race over state.

**Fix:** Track artifact IDs in a `useRef` keyed to the current run, or clear the local array definitively at the start of each `attachStream` invocation.

---

## Medium

### M1 — `delete_session` relies on CASCADE that is silently disabled (consequence of C1)

**File:** `backend/store/sessions.py:279-285`

`DELETE FROM sessions WHERE id = ?` depends on `ON DELETE CASCADE` to clean messages, documents, chunks, artifacts, agent_runs, and trace_events. With foreign keys disabled (C1), all child rows are left orphaned. Session deletion appears to succeed from the UI perspective, but the database grows unboundedly.

**Fix:** Either fix C1 (preferred), or add explicit `DELETE FROM messages WHERE session_id = ?`, etc., in dependency order.

---

### M2 — `create_artifact` does not validate `mime_type` against the enum

**File:** `backend/store/sessions.py:586-608`, `backend/orchestrator/tools.py:157-162`

The tool input schema declares `mime_type` must be one of `["text/plain", "text/markdown", "text/html", "text/csv"]`, but `handle_tool` passes the value straight to `create_artifact` without checking. If the model produces `application/json` or any other string, the artifact preview component falls back to Markdown rendering unconditionally, which is wrong for arbitrary content types.

**Fix:** In `handle_tool`, validate `mime_type` against the allowed set and coerce unknown values to `text/plain` before persisting.

---

### M3 — `_session_tokens` global is dead code

**File:** `backend/app.py:81`

```python
_session_tokens: dict[str, int] = {}
```

This variable is declared at module scope and never read or written anywhere in the codebase. It is leftover scaffolding.

**Fix:** Delete the line.

---

### M4 — `SourceDrawer` has no abort controller — stale fetch can overwrite current chunk content

**File:** `frontend/components/SourceDrawer.tsx:22-34`

The `useEffect` fires `fetch(...)` without an `AbortController`. If the user clicks citation A and then quickly clicks citation B, the in-flight request for A may resolve after B's response and overwrite the displayed chunk with A's content.

**Fix:**

```ts
useEffect(() => {
  if (!chunkId) { setChunk(null); return; }
  const ctrl = new AbortController();
  setLoading(true);
  fetch(`/api/chunks/${chunkId}`, { signal: ctrl.signal })
    ...
  return () => ctrl.abort();
}, [chunkId]);
```

---

### M5 — `CitationLink` in-memory chunk cache never invalidates

**File:** `frontend/components/CitationLink.tsx:17-34`

`_cache: Map<string, ChunkMeta>` is module-scoped and lives for the entire page session. If a document is deleted while the app is open, citations in older messages continue to show the deleted document's filename (cached) until the page reloads. For documents that are frequently deleted and re-uploaded, the stale label is misleading.

**Fix:** Invalidate the cache entries for a document's chunks when the document is deleted. Alternatively, add a TTL or clear the cache when the `documents` list changes.

---

### M6 — `_count_tokens_approx` undercounts SDK object blocks, causing compaction to trigger late

**File:** `backend/orchestrator/compactor.py:37-48`

```python
elif isinstance(content, list):
    for block in content:
        if isinstance(block, dict):
            total += len(str(block)) // 4
```

When the agent loop appends `{"role": "assistant", "content": response.content}`, `response.content` contains `BetaContentBlock` SDK objects — not dicts. The `isinstance(block, dict)` check fails for all of them, contributing zero tokens. The compaction threshold is therefore missed on tool-heavy turns.

**Fix:** Remove the `isinstance(block, dict)` gate and count all block types:

```python
total += len(str(block)) // 4
```

---

### M7 — SSE endpoint can hang indefinitely when no run is in flight

**File:** `backend/orchestrator/event_bus.py:136-141`, `backend/app.py:286-301`

After the `get_or_create` fix (which replaces closed buses with fresh empty ones), a client connecting to a session with `last_run_state = "idle"` or `"completed"` gets a fresh empty `asyncio.Queue`. The SSE consumer blocks on `await self._queue.get()` with no timeout and no event will ever arrive. The browser's SSE connection sits open until the server or browser timeout fires.

**Fix:** In the `/stream` endpoint, check `session["last_run_state"]`; if it is not `"running"`, publish a synthetic `run_complete` event (or return HTTP 204) immediately so the client knows to stop waiting.

---

### M8 — `inferAudience` auto-switch persists to the session, making transient phrasings sticky

**File:** `frontend/app/sessions/[id]/page.tsx:387-396`

When `inferAudience` fires on a user prompt, it calls `api.updateSession(sessionId, { audience: inferred })` and the change persists. A user saying "assume I'm an engineer for this one question" will find their entire session permanently flipped to expert mode, requiring a manual toggle back.

**Fix:** Apply the inferred audience to the outgoing API call without persisting it to the session, or show a confirm prompt in the banner before saving.

---

## Low

### L1 — Splash page uses bare `new Image()` which conflicts with any future `next/image` import

**File:** `frontend/app/page.tsx:23-25`

```ts
SLIDES.forEach((src) => {
  const img = new Image();
  img.src = src;
});
```

`new Image()` works as long as there is no `import Image from "next/image"` in scope. If that import is added later (common in Next.js projects), the constructor silently creates a React component instead of a DOM `HTMLImageElement`.

**Fix:** Use `new window.Image()` to be explicit about the global constructor.

---

### L2 — `SourceDrawer` shows stale "Loading…" state after rapid open/close

**File:** `frontend/components/SourceDrawer.tsx:22-34`

If the user opens the drawer and quickly closes it (`chunkId` becomes `null`) before the fetch resolves, `setLoading(true)` was already called. The next time the drawer opens it shows "Loading…" briefly even if the chunk is already cached. Cosmetic, but addressed naturally by the M4 abort controller fix.

---

### L3 — `chunk_by_pages` ignores actual page numbers from page markers

**File:** `document_chunker.py:32-69`

```python
# Pages captured by re.split are at odd indices but the loop uses a manual counter
for i in range(0, len(pages), 2):
    ...
    page_num += 1  # always increments from 1
```

`re.split` with a capturing group places the captured page number strings at odd indices (`pages[1]`, `pages[3]`, …). The loop iterates only even indices and increments a manual `page_num` starting at 1, ignoring the actual numbers in the document. A PDF starting at page 5 will have its chunks labelled starting at page 1.

**Fix:** Read the page number from the split result: `page_num = int(pages[i + 1])` inside the loop.

---

### L4 — `extract_definitions` regex truncates definitions at the first period or semicolon

**File:** `backend/extractors/definitions.py:23-35`

```python
r'(?P<definition>[^;\.]{10,300})'
```

Legal definitions often span multiple sentences. The character class `[^;\.]` stops at the first `.` or `;`, so a definition like `"Asset" means any property owned by the Company. This includes real and personal property.` is truncated to `"Asset" means any property owned by the Company` (the first sentence only). The partial capture is stored as the authoritative definition.

**Fix:** Extend the pattern to allow up to one sentence boundary and cap by length alone, or anchor on the full definitional clause using a more permissive stop character.

---

### L5 — `_fts5_safe` strips hyphens, apostrophes, and punctuation from legal queries

**File:** `backend/store/sessions.py:21-27`

```python
tokens = re.findall(r"\w+", query or "")
```

A search for `"U.S.C. § 12"` becomes tokens `["U", "S", "C", "12"]` — losing structure and inflating noise. The FTS5 `MATCH` still works but returns far too many results with poor precision for the legal/regulatory content this app is designed for.

**Fix:** Use a broader tokenisation regex such as `r"[\w.\-§()/]+"` and quote each token as an FTS5 phrase.

---

### L6 — `compact` endpoint (manual trigger) compacts in memory but does not persist the result

**File:** `backend/app.py:402-411`

```python
_, compacted = await maybe_compact(history, bus)
return {"compacted": compacted}
```

The compacted message list is discarded. The next real run calls `get_messages` again and loads the full uncompacted history. Manual compaction therefore has no durable effect — it only emits a `compaction_done` SSE event.

**Fix:** Persist the compacted history as a special marker message, or clearly document in the UI and API response that this endpoint is test-only with no lasting effect.

---

### L7 — PDF/DOCX import errors suggest `--break-system-packages` flag

**File:** `document_loader.py:44-47`, `document_loader.py:87-90`

```python
"Install it with: pip install PyPDF2 --break-system-packages"
```

`--break-system-packages` overrides Debian/PEP-668 safety protections. Recommending it in a runtime error message is dangerous — a developer copy-pasting it into a system Python environment could damage OS tooling. The dependencies are already in `requirements.txt`.

**Fix:** Replace the message with: `"Install missing dependencies with: pip install -r requirements.txt"`.

---

### L8 — `ArtifactPreview` panel width from localStorage ignores window resize

**File:** `frontend/components/ArtifactPreview.tsx:87-97`

The saved width is loaded once on mount and clamped to the current `window.innerWidth`. If the user then resizes the browser narrower than the saved value, the preview panel can exceed the viewport width until the user manually re-drags the handle.

**Fix:** Add a `resize` event listener that re-clamps the width when the window is resized.

---

### L9 — `CITATION_RE` regex is duplicated across three files with a shared `g` flag

**Files:** `frontend/lib/citations.ts:8`, `frontend/components/ChatPane.tsx:36`, `frontend/components/ArtifactPreview.tsx:21`

The same regex literal is defined separately in three places. All three use the `/g` flag. `ChatPane.tsx` resets `lastIndex = 0` before use, but if the pattern is ever consolidated incorrectly or one file omits the reset, matches will skip content due to stale `lastIndex` state.

**Fix:** Export `CITATION_RE` from a single shared module and always reset `lastIndex = 0` before each use, or use `new RegExp(...)` per call to avoid state leakage.

---

### L10 — Compactor truncates tool-result content to 500 chars when building the summary

**File:** `backend/orchestrator/compactor.py:76-79`

```python
f"[{m['role'].upper()}]: {m['content'] if isinstance(m['content'], str) else str(m['content'])[:500]}"
```

Tool results (which are lists of `tool_result` dicts) are truncated to 500 characters when handed to the compactor model. For large subagent results or document chunks, this means the compaction summary loses the bulk of the tool output, potentially causing the Lead to re-fetch chunks it already has on the next iteration.

**Fix:** Either increase the limit substantially, or selectively preserve chunk IDs and citation strings while truncating prose.

---

### L11 — `_AUDIENCE_FINALIZE_CHECK` prompt is not audience-specific

**File:** `backend/orchestrator/lead.py:204-210`

The finalize-check block mentions both `layperson` and `expert` conditions regardless of the active audience. For a `professional` audience run, the model reads unnecessary layperson and expert checks. The prompt is still functional, but tighter audience-specific wording would reduce token waste and ambiguity.

**Fix:** Template the check string per audience, mirroring the approach used for `_AUDIENCE_INSTRUCTIONS`.

---

## Summary

| Priority | Count | Highest-impact items |
|---|---|---|
| **Critical** | 4 | C1 (FK pragma not per-connection), C2 (timestamp-based delete), C3 (token count drift), C4 (fire-and-forget extractors) |
| **High** | 7 | H1/H3 (leaked SSE connections), H5 (no real backend cancellation), H4 (useEffect loop) |
| **Medium** | 8 | M1 (orphaned rows from C1), M6 (compaction trigger late), M7 (SSE hangs on idle session) |
| **Low** | 11 | Code quality, precision, and UX polish |

### Recommended fix order

1. **C1** — One-line change (`PRAGMA foreign_keys=ON` outside the guard) that fixes C1, and defuses M1 and the C4 orphan risk.
2. **H1 / H3** — Two-line fix in `attachStream` that stops SSE connection leaks.
3. **C2** — Rowid-based delete to make truncation safe.
4. **M7** — Guard the SSE endpoint against idle sessions to prevent hung connections.
5. **H5** — New cancel endpoint + cancellation event in `run_lead` (largest new feature).
6. Remaining items in priority order.
