# Technical Documentation — Constellation

Comprehensive technical reference for developers working with Constellation. For a user-facing guide see [README.md](README.md); for a higher-level architectural overview see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Table of contents

- [1. System overview](#1-system-overview)
- [2. Backend](#2-backend)
  - [2.1 Process model](#21-process-model)
  - [2.2 HTTP API reference](#22-http-api-reference)
  - [2.3 Pydantic schemas](#23-pydantic-schemas)
  - [2.4 Request/response lifecycle](#24-requestresponse-lifecycle)
- [3. Agent orchestration](#3-agent-orchestration)
  - [3.1 Lead Orchestrator](#31-lead-orchestrator)
  - [3.2 SubAgents](#32-subagents)
  - [3.3 Lead tool catalogue](#33-lead-tool-catalogue)
  - [3.4 Citation enforcement](#34-citation-enforcement)
  - [3.5 Compaction](#35-compaction)
  - [3.6 Prompt caching](#36-prompt-caching)
  - [3.7 Advisor tool (optional)](#37-advisor-tool-optional)
- [4. Event bus and SSE protocol](#4-event-bus-and-sse-protocol)
  - [4.1 Event types](#41-event-types)
  - [4.2 Trace persistence](#42-trace-persistence)
- [5. Data layer](#5-data-layer)
  - [5.1 Schema](#51-schema)
  - [5.2 FTS5 safety](#52-fts5-safety)
  - [5.3 Migrations](#53-migrations)
- [6. Document ingestion pipeline](#6-document-ingestion-pipeline)
- [7. Extractors](#7-extractors)
- [8. Frontend](#8-frontend)
  - [8.1 Routes and flow](#81-routes-and-flow)
  - [8.2 State model for the session page](#82-state-model-for-the-session-page)
  - [8.3 Streaming strategy](#83-streaming-strategy)
  - [8.4 Citation rendering and source drawer](#84-citation-rendering-and-source-drawer)
  - [8.5 Artifact preview](#85-artifact-preview)
- [9. CLI](#9-cli)
- [10. Configuration](#10-configuration)
- [11. Security and safety considerations](#11-security-and-safety-considerations)
- [12. Performance notes](#12-performance-notes)
- [13. Extending the system](#13-extending-the-system)
- [14. Testing](#14-testing)

---

## 1. System overview

Constellation is a three-tier application:

1. **Frontend** — Next.js 15 App Router + React 19 + Tailwind. Single-page experience across Splash (`/`), Home (`/home`), and Session (`/sessions/[id]`).
2. **Backend** — FastAPI running on `uvicorn`, exposing REST + Server-Sent Events (SSE). All I/O is async; SQLite access goes through `aiosqlite`.
3. **Agent orchestration** — an async orchestrator-workers pattern built on the Anthropic SDK. A Lead agent (Sonnet by default, Opus for production) plans, calls tools, and spawns SubAgents (Haiku) that run in parallel via `asyncio.gather`.

All persistent state lives in a single SQLite file (`deep_reading.db`) using WAL mode. An FTS5 virtual table backs keyword search. No external services are required beyond the Anthropic API.

---

## 2. Backend

### 2.1 Process model

- Single `uvicorn` process exposes the ASGI app defined in [backend/app.py](backend/app.py).
- Each inbound message POST kicks off a background `asyncio.Task` running `run_lead(...)`. The HTTP call returns `202 Accepted` with the persisted user message; the actual agent work streams via SSE.
- A process-wide `EventBusRegistry` maps `session_id → SessionEventBus`. The bus is an `asyncio.Queue` of JSON-serialisable event dicts plus a sentinel for end-of-stream.
- The SSE endpoint consumes from the same bus; if no run is active the endpoint returns an empty/open stream ready to receive the next run's events.

### 2.2 HTTP API reference

All routes are mounted under `/api`. Base URL defaults to `http://localhost:8000`.

| Method | Path | Status | Description |
| --- | --- | --- | --- |
| POST | `/api/sessions` | 201 | Create a session. Body: `{ title?: string }`. |
| GET | `/api/sessions` | 200 | List sessions, pinned first, newest next. |
| GET | `/api/sessions/{id}` | 200 | Session detail: session + messages + documents + artifacts. |
| PATCH | `/api/sessions/{id}` | 200 | Update `title` and/or `pinned`. |
| DELETE | `/api/sessions/{id}` | 200 | Cascade-delete session and all its children. |
| DELETE | `/api/sessions/{id}/messages/after/{message_id}` | 200 | Truncate history from a pivot message onward (edit / retry). |
| POST | `/api/sessions/{id}/documents` | 201 | Multipart upload; ingests + chunks + indexes the file. |
| DELETE | `/api/sessions/{id}/documents/{document_id}` | 200 / 404 / 409 | Remove a document from the session. **409** if the document is referenced by any persisted message's `attached_document_ids` (would orphan chip rendering on past turns). |
| POST | `/api/sessions/{id}/messages` | 202 | Submit user prompt. Body: `{ content: string, audience: "layperson"\|"professional"\|"expert", attached_document_ids?: string[] }`. Document IDs are persisted on the message so chip rendering survives reloads. Kicks off the agent run. |
| GET | `/api/sessions/{id}/stream` | 200 (SSE) | Server-Sent Events stream of agent events. |
| GET | `/api/sessions/{id}/context` | 200 | Token usage estimate: `{ tokens, window, percent }`. Builds the full prompt overhead (rendered system prompt for the session's audience + tool definitions + doc index up to 50 chunks) so the value matches what a real run publishes in `context_usage` SSE events. Used to seed the context meter on session mount. |
| POST | `/api/sessions/{id}/compact` | 200 | Manually trigger context compaction. |
| POST | `/api/sessions/{id}/count_tokens` | 200 | Pre-send token estimate. Body: `{ content: string, attached_document_ids?: string[] }`. Returns `{ prompt_tokens, base_tokens, total_tokens, window, percent }`. Calls Anthropic's free `count_tokens` endpoint under the hood; falls back to the in-house approximation on failure. |
| GET | `/api/sessions/{id}/trace` | 200 | Replay persisted trace events: `{ events: PersistedTraceEvent[] }`. |
| GET | `/api/artifacts/{id}` | 200 | Artifact content + metadata (for download or preview). |
| GET | `/api/chunks/{id}` | 200 | Source chunk content + document filename (powers the citation drawer). |

CORS is configured to allow `http://localhost:3000` and `http://127.0.0.1:3000`.

### 2.3 Pydantic schemas

All request/response bodies are typed via Pydantic v2 models in [backend/models.py](backend/models.py). Key shapes:

- `SessionCreate { title? }`
- `SessionUpdate { title?, pinned?, audience? }` — audience is persisted on the session so reloads restore the user's last choice. (Note: `last_run_state` is set internally by `submit_message` and the `_run` finally block; it is not part of the public PATCH surface.)
- `SessionOut { id, title, created_at, pinned, audience, last_run_state }` — `last_run_state` is one of `idle | running | completed | error`; the frontend reads it on session mount to decide whether to re-attach the SSE stream.
- `SessionDetail { session, messages, documents, artifacts }`
- `MessageCreate { content, audience, attached_document_ids[] }` — `attached_document_ids` records which documents were attached at send time so chips re-render correctly after reload.
- `MessageOut { id, session_id, role, content, token_usage?, created_at, artifact_ids[], thinking?, attached_document_ids[], attached_documents[] }` — `attached_documents` is hydrated from the documents table to filenames so the frontend can render chips without a second lookup.
- `DocumentOut { id, session_id, filename, chunk_count, original_filename? }`
- `ArtifactOut { id, session_id, name, content, mime_type, citations_json? }`
- `ContextUsageOut { tokens, window, percent }`
- `TokenCountRequest { content: string = "", attached_document_ids?: list[str] }`
- `TokenCountOut { prompt_tokens, base_tokens, total_tokens, window, percent }`
- `AgentRunOut { id, session_id, parent_agent_id?, role, status, tokens_in, tokens_out }`

The audience field is validated against `^(layperson|professional|expert)$` on both `SessionUpdate` and `MessageCreate`.

### 2.4 Request/response lifecycle

For a single user turn:

1. `POST /api/sessions/{id}/messages` — persists the user message (with `attached_document_ids`) and auto-derives the session title if this is the first message.
2. `event_registry.ensure_live(session_id)` returns a fresh open bus (replacing any closed bus from a prior run).
3. `next_trace_run_index(session_id)` allocates a sequential `run_index` for trace persistence.
4. **`update_session(last_run_state="running")`** — the session row is flagged so any client that mounts the session page (or returns from another session) can detect the in-flight run and re-subscribe.
5. The server schedules `asyncio.create_task(_run())`, which calls `run_lead(...)` and, in `finally`, closes the bus and writes a terminal `last_run_state` of `completed` or `error`. The HTTP response returns immediately with 202.
6. The browser opens `GET /api/sessions/{id}/stream` via `EventSource`. Events are delivered as `data: {json}\n\n` lines. The stream closes when `run_complete` or `error` fires.

Idempotency is not implemented — double-submitting a message creates two runs. Clients should disable the send button while `isStreaming` is true (the frontend does).

#### Multi-session SSE re-attach

When a user navigates away from a session whose run is still in flight, the browser-side `EventSource` is closed by the React unmount cleanup, but the **backend bus stays open** because `_run` is an `asyncio.Task` that doesn't observe HTTP-client disconnects. When the user returns:

1. The session page calls `GET /api/sessions/{id}` and reads `session.last_run_state`.
2. If the value is `"running"`, the page calls `attachStream()` immediately and a new `EventSource` connects to `GET /api/sessions/{id}/stream`.
3. `event_registry.get_or_create(session_id)` returns the still-open bus, and `consume()` yields any events still in the queue plus all subsequent events. The persisted trace (`GET /api/sessions/{id}/trace`) backfills events that fired and were drained while the user was away.
4. If the run finished while the user was away (`last_run_state == "completed"` or `"error"`), the bus has already closed; the new `consume()` immediately yields the sentinel and the SSE `onClose` handler refetches session detail to show the persisted assistant message.

---

## 3. Agent orchestration

### 3.1 Lead Orchestrator

Defined in [backend/orchestrator/lead.py](backend/orchestrator/lead.py). The Lead is a single-turn Anthropic Messages call placed inside a bounded agentic loop:

- **Max iterations**: 40 (safety limit).
- **Max tokens per call**: 64,000.
- **Tools available**: `search_document`, `read_document_chunk`, `resolve_reference`, `lookup_definition`, `spawn_subagent`, `write_artifact`, `finalize`.
- **System prompt**: rendered by `build_system_prompt(audience)` (exported for use by token-counting endpoints). Augmented with the selected audience instruction and marked `cache_control: { type: "ephemeral" }` to enable prompt caching with a 1-hour TTL.
- **Initial user content**: optionally preceded by prior chat history (see below), then a doc-index block (up to 50 chunks), an artifact catalogue (see below), and the user's question.

**Conversation history replay.** Prior persisted user/assistant turns are prepended to the `messages` array before each run. Tool-use blocks are excluded — the recap text already references artifacts by name and chunks by UUID. Without this, follow-up prompts ("convert that to CSV", "extend point 3") produced hallucinated chunk IDs because the model had no memory of what it wrote in previous turns.

**Artifact catalogue.** Existing session artifacts are listed under a `## Existing Artifacts In This Session` block in the initial user content (up to 400 chars of content preview per artifact). This lets the Lead acknowledge and reference prior artifacts on follow-up requests without re-running the full document pipeline.

**`run_complete` ordering.** In all three finalization branches, `add_message(...)` is awaited before `bus.publish("run_complete", ...)`. The SSE consumer calls `getSession()` immediately on receiving `run_complete`; if the assistant row hasn't been written yet, that fetch returns stale data and the streaming bubble hangs until a reload.

On each iteration the Lead:

1. Calls `maybe_compact(messages, bus)` which summarises older turns if estimated tokens exceed 85% of the 200K window.
2. Publishes a `context_usage` event.
3. Streams the model response; tokens are forwarded as `thinking_delta` events so the UI can render them in a collapsible thinking panel.
4. On `stop_reason == "tool_use"`, iterates over tool blocks:
   - `spawn_subagent` calls are batched and run concurrently with `asyncio.gather` at the end of the block.
   - `finalize` ends the loop immediately, publishes `final_message` and `run_complete`, and persists the assistant reply.
   - Other tools are dispatched through `handle_tool(...)` in [backend/orchestrator/tools.py](backend/orchestrator/tools.py).
5. Appends the assistant turn and tool results to `messages` and continues.

**Finalize contract.** The Lead's system prompt forces `finalize.result` to be a substantive user-facing recap, not a one-liner. If the Lead calls `write_artifact` and returns an empty or trivially short (`len < 500`) `result`, the `finalize` branch in [backend/orchestrator/lead.py:303](backend/orchestrator/lead.py#L303) backfills a fallback pointing at the artifact name(s) so the UI never shows a blank message.

**`finalize`-miss recovery ladder.** If the loop exits without `finalize` ever being called (iteration cap hit, `stop_reason` something other than `tool_use`/`end_turn`, model returned only tool calls with no text), [lead.py:389](backend/orchestrator/lead.py#L389) walks three tiers:

1. Scrape trailing `text` blocks from the last response.
2. If artifacts were produced this turn, backfill a recap pointing the user at them.
3. Last resort: explicit "couldn't produce an answer, try Retry" message. Never persist an empty string.

Additionally, when `stop_reason == "end_turn"` and the model returned plain text (a chat-style answer instead of calling `finalize`), the Lead publishes a `thinking_clear` event before re-emitting the text as the user-facing message, so the same content isn't shown twice.

### 3.2 SubAgents

Defined in [backend/orchestrator/subagent.py](backend/orchestrator/subagent.py). Each SubAgent is a fresh Messages call with:

- A dedicated `agent_id` (UUID) and an `agent_runs` row.
- A cached system prompt including the role, audience instruction, and the citation rule.
- A user message containing a **chunk index** of exactly the chunk IDs the Lead handed it.
- A single tool: `read_document_chunk`.
- Max 20 iterations, max 10,000 tokens per call.

Output is streamed as `thinking_delta` (not `text_delta`) because the Lead consumes the subagent's `result_text` via the return value, not via the chat stream. `agent_done` fires when the subagent returns, carrying up to 2000 chars as a summary (raised from 200 in 2.2).

### 3.3 Lead tool catalogue

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `read_document_chunk` | Fetch full chunk text by UUID. | `chunk_id` |
| `search_document` | FTS5/BM25 search within one document. Returns top-N hits with section, page, score. | `document_id`, `query`, `limit?` |
| `resolve_reference` | Look up a chunk by its `section_id` (cross-reference resolution). | `document_id`, `section_id` |
| `lookup_definition` | Case-insensitive lookup of a defined term previously extracted. | `document_id`, `term` |
| `spawn_subagent` | Run a focused subagent in parallel with an isolated context. | `role`, `task`, `chunk_ids[]` |
| `write_artifact` | Persist a named artifact (Markdown/HTML/CSV/plain text) with optional citations. | `name`, `content`, `mime_type?`, `citations?` |
| `finalize` | End the run and return the final user-facing answer. | `result` |

All schemas are the JSON Schemas sent to Claude in `LEAD_TOOLS`. See [backend/orchestrator/tools.py](backend/orchestrator/tools.py).

### 3.4 Citation enforcement

Two checks are applied to every subagent result before it is returned to the Lead:

**Check 1 — Presence** ([backend/orchestrator/subagent.py](backend/orchestrator/subagent.py)): the result text is scanned with `_CITATION_RE = re.compile(r'\[[0-9a-fA-F\-]{36}\]')`. If no UUID-shaped token is found, `citations_present: false` is set.

**Check 2 — Validity** ([backend/orchestrator/subagent.py](backend/orchestrator/subagent.py)): every UUID extracted by the regex is looked up in the database via `get_chunk`. Any UUID that returns `None` is a hallucinated chunk ID — one the model invented rather than drew from the index it was given. `citations_valid: false` is set and the offending IDs are collected in `invalid_citation_ids`.

Both flags and the list of invalid IDs are forwarded to the Lead inside the `tool_result` content block, along with a plain-English `note` field. The Lead's system prompt instructs it not to synthesize from a result where either flag is false, and to re-spawn the task instead.

**Vocabulary restriction**: the subagent system prompt explicitly lists the valid chunk IDs it was given for the task under a `VALID CHUNK IDs FOR THIS TASK` heading and instructs the model to cite only from that list. This reduces the surface area for hallucination to UUIDs the model can actually see, and makes any out-of-vocabulary citation immediately catchable by Check 2.

The Lead itself is held to the same citation contract in its system prompt; `finalize.result` is expected to carry `[chunk_id]` citations on every factual claim.

### 3.5 Compaction

Implemented in [backend/orchestrator/compactor.py](backend/orchestrator/compactor.py).

- **Window**: 200,000 tokens (matches Claude's context window on the configured models).
- **Threshold**: 85% (≈170K tokens) triggers automatic compaction.
- **Target**: ~20% after compaction.
- **Strategy**: keep the last `max(4, len(messages) // 5)` messages verbatim; summarise everything before into a structured memory via a Haiku Messages call.
- Output replaces the compacted prefix with two synthetic messages: `[COMPACTED SESSION HISTORY]\n{summary}` (user) and `Understood. Continuing from the compacted history.` (assistant).
- A `compaction_done` event with `before_tokens` and `after_tokens` is published, and the corresponding trace row is persisted.

Token counting is approximated as `len(str) // 4` for speed — accurate enough for threshold detection.

### 3.6 Prompt caching

Both the Lead and SubAgent system prompts carry `cache_control: { type: "ephemeral" }`. Cache TTL is Anthropic's default (1 hour for ephemeral). Benefit:

- The 50-chunk index attached to the Lead's first user message is not cached (it's per-session), but the large role + instruction preamble is.
- Subagent system prompts are cached on a per-(role, audience) basis. Re-spawning a subagent with the same role in a short window avoids re-ingesting the system prompt.

### 3.7 Advisor tool (optional)

Gated behind the `ADVISOR_MODEL` environment variable. Unset (default): the Lead runs with the standard `LEAD_TOOLS` list via `client.messages.stream(...)`. Set to a model ID (e.g. `claude-opus-4-7`): `_build_tools(use_advisor=True)` in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) appends an `advisor_20260301` beta tool to the toolset and the call is routed through `client.beta.messages.stream(...)` with the `advisor-tool-2026-03-01` beta header.

**Tool spec.**

```json
{
  "type": "advisor_20260301",
  "name": "advisor",
  "model": "<ADVISOR_MODEL>",
  "max_uses": 3
}
```

Three uses per run is intentional — it maps to the three natural decision points: planning check, post-synthesis review, and pre-finalize quality gate. Raising `max_uses` burns advisor-model tokens without a clear payoff.

**Surfacing advisor output.** Advisor inference runs server-side inside the same Messages call; the stream pauses silently during sub-inference. Results arrive as `advisor_tool_result` blocks in `response.content` after `stop_reason == "tool_use"`. The Lead loop inspects each block and emits its text as a `thinking_delta` event prefixed with `[Advisor]` so the user sees the advice live in the Thinking panel.

**Token accounting.** Advisor iterations are billed at the advisor model's rate, not the executor's. The Lead accumulates advisor tokens into its own `tokens_in` / `tokens_out` via `response.usage.iterations` (accessed with `getattr` because the field isn't in the typed SDK schema yet). This keeps the per-turn totals correct in the context meter and `agent_runs` table.

**Safety caveat.** The advisor must be at least as capable as the executor — setting it to a weaker model makes no sense. The recommended configuration is Haiku executor + Opus advisor.

---

## 4. Event bus and SSE protocol

Implemented in [backend/orchestrator/event_bus.py](backend/orchestrator/event_bus.py).

- `SessionEventBus` wraps an `asyncio.Queue`. `publish(event_type, **data)` is non-blocking.
- `close()` enqueues a sentinel; `consume()` yields `data: <json>\n\n` strings until the sentinel arrives.
- `EventBusRegistry.get_or_create` returns the existing bus or creates one; `ensure_live` replaces a closed bus for a new run.

The SSE endpoint ([backend/app.py](backend/app.py)) returns a `StreamingResponse` with headers:

- `Cache-Control: no-cache`
- `X-Accel-Buffering: no` (disables buffering on reverse proxies).

### 4.1 Event types

| Event | Fields | Description |
| --- | --- | --- |
| `agent_spawned` | `agent_id`, `role`, `parent` | New agent started. `parent` is `null` for the Lead, `"lead"` or a UUID for subagents. |
| `thinking_delta` | `agent_id`, `delta` | Streaming reasoning/planning text. |
| `thinking_clear` | `agent_id` | UI-only signal: tells the frontend to drop the live Thinking panel display. Fired when the Lead ends a turn with `stop_reason == "end_turn"` (plain-text response instead of `finalize`) so the same text isn't shown twice — once in Thinking, once as the final message. **Does NOT wipe the server-side `_thinking_buffer`** — that buffer is the historical record and must persist so the assistant message's `thinking` field is non-empty after `finalize`. |
| `text_delta` | `agent_id`, `delta` | Legacy streaming chat text (still supported by the frontend for forward compatibility). |
| `final_message` | `content` | The authoritative final answer from the Lead. Emitted once. |
| `tool_use` | `agent_id`, `tool`, `input` | Agent called a tool with the given input. |
| `artifact_written` | `artifact_id`, `name` | Artifact persisted. |
| `agent_done` | `agent_id`, `summary` | Subagent finished; `summary` is the first 200 chars of its output. |
| `run_complete` | `final` | Full Lead run finished. Triggers client stream close. |
| `context_usage` | `tokens`, `window`, `percent` | Context meter update. |
| `compaction_done` | `before_tokens`, `after_tokens` | Compaction completed. |
| `error` | `message` | Unhandled exception during the run. Triggers client stream close. |

### 4.2 Trace persistence

A subset of events is persisted to the `trace_events` table so the UI can replay history after a reload or when switching between sessions. Persisted types (see [backend/orchestrator/event_bus.py:21](backend/orchestrator/event_bus.py#L21)):

- `agent_spawned`, `tool_use`, `artifact_written`, `agent_done`, `compaction_done`.

Every run gets a monotonically increasing `run_index` (from `next_trace_run_index`). Within a run, events are numbered `seq = 0, 1, 2, …`. The frontend maps these to `TraceEntry` objects on session load via `persistedToTrace` in [frontend/app/sessions/[id]/page.tsx](frontend/app/sessions/%5Bid%5D/page.tsx).

Persistence is best-effort — if `append_trace_event` raises, the error is swallowed so it can't crash a live run.

---

## 5. Data layer

All persistence is a single SQLite file accessed via `aiosqlite`. DDL is in [backend/store/sessions.py](backend/store/sessions.py).

### 5.1 Schema

```sql
-- User-facing chats
sessions(id TEXT PK, title TEXT, created_at TEXT NOT NULL,
         pinned INTEGER DEFAULT 0,
         audience TEXT NOT NULL DEFAULT 'professional',
         last_run_state TEXT NOT NULL DEFAULT 'idle')

-- Chat history (per-message attachments + thinking buffer + artifact ids)
messages(id TEXT PK, session_id FK, role TEXT, content TEXT,
         token_usage INTEGER, created_at TEXT,
         artifact_ids_json TEXT, thinking TEXT,
         attached_document_ids_json TEXT)

-- Uploaded files
documents(id TEXT PK, session_id FK, filename TEXT, original_filename TEXT, chunk_count INTEGER)

-- Chunked content
chunks(id TEXT PK, document_id FK, idx INTEGER, content TEXT, metadata TEXT, section_id TEXT, page INTEGER)

-- Full-text search (FTS5 external-content virtual table)
chunks_fts USING fts5(content, content=chunks, content_rowid=rowid, tokenize="unicode61")

-- Extracted features
definitions(id, document_id FK, term, definition, source_chunk_id)
cross_refs(id, document_id FK, from_chunk_id, to_section_id)

-- Agent outputs
artifacts(id, session_id FK, name, content, mime_type DEFAULT 'text/markdown', citations_json)
agent_runs(id, session_id FK, parent_agent_id, role, status, tokens_in, tokens_out)

-- Persisted trace events
trace_events(id, session_id FK, run_index INTEGER, seq INTEGER, event_type, payload JSON, created_at)
  INDEX (session_id, run_index, seq)
```

Triggers (`chunks_ai`, `chunks_ad`, `chunks_au`) keep `chunks_fts` synchronised with `chunks` on insert, delete, and update.

`PRAGMA journal_mode=WAL` is set on every connection; `PRAGMA foreign_keys=ON` enables cascade deletes.

### 5.2 FTS5 safety

LLM-generated search queries can contain FTS5 operators (`:`, `-`, `NEAR`, column filters) that break the parser or trigger unexpected behaviour. `_fts5_safe(query)` in [backend/store/sessions.py](backend/store/sessions.py) tokenises on `\w+` and wraps each token in quotes, producing a phrase AND query. An empty result falls back to `""` so the MATCH never explodes.

### 5.3 Migrations

There is no migration framework. Lightweight inline migrations run in `_init_db` ([backend/store/sessions.py](backend/store/sessions.py)). Each is gated on a `PRAGMA table_info` check so re-running on an already-migrated DB is a no-op.

- `sessions.pinned INTEGER DEFAULT 0` — added in 2.0.
- `sessions.audience TEXT NOT NULL DEFAULT 'professional'` — added in 2.1.
- `sessions.last_run_state TEXT NOT NULL DEFAULT 'idle'` — added in 2.2 to support multi-session SSE re-attach. Values: `idle | running | completed | error | cancelled`.
- `documents.original_filename TEXT` — added in 2.0; backfilled from `filename`.
- `messages.artifact_ids_json TEXT` — added in 2.0 for per-turn artifact linkage.
- `messages.thinking TEXT` — added in 2.0 for persisted reasoning trace.
- `messages.attached_document_ids_json TEXT` — added in 2.2 so per-message document chips re-render correctly after reload.

No schema changes in 2.3.x. The `get_chunks_for_document(document_id, limit?)` helper gained an optional `limit` parameter in 2.3.3 (SQL-level `LIMIT ?`); callers that previously sliced results in Python now delegate to the database.

Schema changes are idempotent because every DDL is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` and every `ALTER TABLE` is gated on a column-presence check.

---

## 6. Document ingestion pipeline

Entry point: `DocumentStore.ingest(session_id, file_path, original_filename?)` in [backend/store/documents.py](backend/store/documents.py).

1. **Load** — `DocumentLoader.load_document(path)` in [document_loader.py](document_loader.py) dispatches by extension (PDF via PyPDF2, DOCX via python-docx, TXT / MD / HTML via built-ins).
2. **Chunk** — `DocumentChunker(max_chunk_tokens=4000)` in [document_chunker.py](document_chunker.py) detects page / chapter / section structure and emits semantic chunks with metadata (default 4,000 tokens ≈ 16,000 chars).
3. **Create document** — inserts a row with the user-facing `original_filename`. Display names always flow through so the UI never surfaces the OS temp path.
4. **Insert chunks** — each chunk becomes a row in `chunks`; FTS5 triggers index it automatically. `section_id` and `page` are derived from the chunker's metadata when available.
5. **Kick off extractors** — the REST handler schedules `extract_definitions` and `extract_cross_refs` as background `asyncio.Task`s so the HTTP response can return immediately.

The backend always writes the upload to a `tempfile.NamedTemporaryFile` first, ingests from there, and `os.unlink`s the temp file in `finally`. The original filename travels through as a separate argument.

---

## 7. Extractors

- **Definitions** — [backend/extractors/definitions.py](backend/extractors/definitions.py). Regex + heuristics to identify "Licensee means…", "Effective Date: …", and similar patterns common in legal/policy text. Writes into the `definitions` table for `lookup_definition`.
- **Cross-references** — [backend/extractors/cross_refs.py](backend/extractors/cross_refs.py). Detects phrases like "see Section 4.2", "Article 12(3)", etc. Writes into `cross_refs`, keyed `(document_id, from_chunk_id, to_section_id)` so `resolve_reference` can jump from a mention to the referenced chunk.

Both extractors are best-effort and run after ingest. A failure does not block the upload.

---

## 8. Frontend

### 8.1 Routes and flow

| Route | File | Purpose |
| --- | --- | --- |
| `/` | [frontend/app/page.tsx](frontend/app/page.tsx) | Splash with crossfading backdrop slideshow (6 s interval, 2 s fade; images from [frontend/public/splash/](frontend/public/splash/)) + dark gradient overlay + white START button → `/home`. |
| `/home` | [frontend/app/home/page.tsx](frontend/app/home/page.tsx) | Greeting + audience toggle + draft upload + prompt bar. |
| `/sessions/[id]` | [frontend/app/sessions/[id]/page.tsx](frontend/app/sessions/%5Bid%5D/page.tsx) | Chat, trace, artifact preview, source drawer. |

**Draft session handoff.** On `/home`, typing a prompt creates a session if none exists, then navigates to `/sessions/<id>?prompt=<text>&audience=<a>`. The session page detects these query params on mount, appends the user message, opens the SSE stream, and fires the POST — then immediately replaces the URL (without query params) via `router.replace`.

### 8.2 State model for the session page

Managed with React `useState` hooks. Key pieces of state:

- `session`, `messages`, `documents`, `artifacts` — hydrated from `GET /api/sessions/{id}`. Each `Message` carries `attached_documents` (resolved filenames), so the chip render is purely declarative.
- `traceEntries` — hydrated from `GET /api/sessions/{id}/trace` on mount, appended live from SSE events.
- `streamingText` — the in-progress final answer during a run (replaced wholesale by `final_message`).
- `thinkingText` — accumulated `thinking_delta` text.
- `isStreaming` — true while SSE is active. Disables send, Compose, and retry/edit controls.
- `liveContextPercent` — seeded from `/context`, updated from `context_usage` events.
- `drawerChunkId`, `previewArtifact`, `uploadOpen`, `editingTitle`, `titleDraft` — UI state.

Refs (not state — don't trigger re-renders):

- `stopRef` — current `EventSource` unsubscriber. Cleared by `handleStop` and by the unmount effect so navigating between sessions doesn't leak connections.
- `didAttachInitial` — guards against double-attach on the first mount (handoff prompt vs. running-run reattach).
- `pendingCommitRef` — holds the deferred `run_complete` flush until the typewriter finishes revealing the recap. See *Deferred-commit pattern* above.

`ChatMessage` was widened in 2.2 to include a transient `role: "system"` variant with `systemKind: "audience_change"`, rendered as a centred italic banner (`~ switched to layperson mode ~`). System messages are not persisted — they live in client state only and are emitted on explicit toggle clicks and on prompt-inferred audience switches.

`attachStream` in the session page is the single entry point for wiring `EventSource` events into state. Each run's artifacts are tracked in a local `runArtifactIds` array so the assistant message persisted at `run_complete` can carry just the files produced for that specific turn.

**Artifact reveal sequence (2.3.3).** `setRunArtifactIds` is no longer called from the `artifact_written` handler. Instead, IDs are buffered in a local `runArtifactIds` array and the "Generated files" button only appears when `commit()` swaps the streaming bubble for the persisted message (step 2). The artifact preview canvas opens 600 ms after that (step 3), giving the button time to render before the canvas slides in. This eliminates the layout shift that made long answers appear to stop mid-sentence.

**Token counter caching (2.3.3).** `ChatPane` maintains a `baseTokenCacheRef` that holds the last fetched `{ base_tokens, window, docKey }`. The base count is refetched from `POST /count_tokens` (with empty content) only when the document set changes or `isStreaming` flips from `true` to `false`. Keystrokes compute `prompt_tokens = Math.ceil(input.length / 4)` locally and derive `total_tokens = base_tokens + prompt_tokens` without a network round-trip. `ContextMeter` no longer fetches `GET /context` independently — it receives `totalTokens` and `window` props from `ChatPane`.

### 8.3 Streaming strategy

The SSE client in [frontend/lib/sse.ts](frontend/lib/sse.ts) connects **directly to `http://<host>:8000`**, bypassing the Next.js proxy. Reason: Next.js proxies buffer streamed responses and deliver every event in a single burst at the end of the run, which defeats the purpose of streaming. The base URL can be overridden with `NEXT_PUBLIC_SSE_BASE`.

Event dispatch:

- `thinking_delta` → appended to `thinkingText`; rendered in a collapsible "Thinking…" block inside the current assistant message slot.
- `thinking_clear` → resets the **client-side** `thinkingText` so the Lead's plain-text end-of-turn response isn't duplicated (once in Thinking, once as the final message). The server-side buffer in `SessionEventBus` is *not* cleared — it's needed to persist a non-empty `thinking` field on the committed assistant message.
- `text_delta` (legacy) → accumulated as `streamingText`.
- `final_message` → wholesale replaces `streamingText` with the authoritative answer. The `useTypewriter` hook in [ChatPane](frontend/components/ChatPane.tsx) then progressively reveals it client-side at ~150 chars / second.
- `artifact_written` → reloaded via `GET /api/sessions/{id}` so the full artifact body is available for the preview canvas; the newest artifact is auto-opened.
- `run_complete` → **deferred commit** (see below).
- `error` → appends an error message and clears streaming state.

If the EventSource closes without a `run_complete` (e.g. network blip), the `onClose` callback first checks `pendingCommitRef`; if there is no pending commit it refetches session detail and commits whatever the backend persisted, so nothing is lost silently.

#### Deferred-commit pattern for `run_complete`

The backend publishes `final_message` and `run_complete` back-to-back in the `finalize` branch ([backend/orchestrator/lead.py](backend/orchestrator/lead.py)). If `run_complete` were processed naively — replacing the live streaming bubble with the persisted bubble from `getSession()` — the typewriter would never have a chance to animate, because the live `streamingText` would be cleared within tens of milliseconds of being set.

The session page solves this with a `pendingCommitRef`:

1. On `run_complete`, the page fetches authoritative session detail and **stashes** the flush as a closure in `pendingCommitRef.current` instead of running it immediately.
2. The `useTypewriter` hook tracks `displayed.length` versus `target.length` and fires its `onComplete` callback exactly once per fully-revealed recap.
3. `onComplete` invokes the stashed flush, which calls `setMessages(...)`, clears `streamingText` / `thinkingText`, and sets `isStreaming = false` — handing off cleanly from the live streaming bubble to the persisted bubble.
4. The on-close handler also early-returns when a pending commit is present so it can't clobber the live state mid-animation.

The empty-recap edge case (rare — a `finalize` with empty `result` that the backfill catches) flushes immediately because there is nothing to type out.

### 8.4 Citation rendering and source drawer

Utility: [frontend/lib/citations.ts](frontend/lib/citations.ts). The chat renderer replaces `[chunk_id]` substrings with `<CitationLink>` components that open `SourceDrawer` with the clicked chunk. `SourceDrawer` calls `GET /api/chunks/{id}` which also returns the document filename (so the drawer header can show a meaningful label instead of an opaque hash).

**`CitationLink` null-result handling (2.3.3).** A `null` response from `GET /api/chunks/{id}` is not written to the in-memory `_cache`. If the fetch returns null and no retry has been attempted yet, a `setTimeout` schedules one retry after 2 seconds. This catches chunks that were not committed to the database when citations first rendered during streaming (the Lead publishes `final_message` and the frontend renders citations before `add_message` completes in some edge cases). After the retry, null results are accepted as final so the component doesn't loop indefinitely.

### 8.5 Artifact preview

[frontend/components/ArtifactPreview.tsx](frontend/components/ArtifactPreview.tsx) is a flex-row sibling of the chat (not an overlay), so opening it shrinks the chat column instead of covering it. It supports:

- **Markdown** — rendered with `react-markdown` + `remark-gfm` + `rehype-highlight`.
- **HTML** — rendered in a sandboxed frame.
- **CSV** — rendered as a table.
- **Plain text** — preformatted.

A download button saves the raw content with the artifact's MIME type.

---

## 9. CLI

[cli.py](cli.py) drives the **same async orchestrator** as the web app. It does not require the FastAPI server.

Flow:

1. Assert `ANTHROPIC_API_KEY` is set.
2. `create_session(title=f"CLI: {filename}")` — each CLI invocation creates a fresh session row.
3. `DocumentStore.ingest(...)` chunks and persists the document.
4. Run extractors inline (not as background tasks).
5. If `--interactive`, loop on stdin; otherwise run one request.
6. Each question calls `run_lead(...)` with an in-memory `SessionEventBus`. Verbose mode prints event summaries; otherwise only the final answer is printed.

Outputs use stdout for the answer and stderr for progress so `python cli.py ... > answer.md` captures only the answer.

---

## 10. Configuration

| Knob | Where | Default | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | env | — | Required. |
| `ANTHROPIC_MODEL` | env | `claude-sonnet-4-6` | Overrides Lead, SubAgent, and Compactor models. |
| `ADVISOR_MODEL` | env | `""` *(disabled)* | Enables the Lead's Advisor tool (`advisor_20260301` beta). Set to a model ID (e.g. `claude-opus-4-7`) that is ≥ the executor in capability. Leave empty to disable. |
| `NEXT_PUBLIC_SSE_BASE` | env (frontend) | `http://<host>:8000` | SSE base URL. |
| Context window | `compactor.WINDOW` | 200,000 | Set to match the deployed model's window. |
| Compaction threshold | `compactor.COMPACT_THRESHOLD` | 0.85 | Fraction of window that triggers compaction. |
| Chunk size | `DocumentStore(chunk_tokens=4000)` | 4,000 tokens | Tune for the document style. |
| Lead iteration cap | `lead.py` loop | 40 | Safety limit. |
| SubAgent iteration cap | `subagent.py` loop | 20 | Safety limit. |
| Lead max_tokens | `lead.py` | 64,000 | Per call. |
| SubAgent max_tokens | `subagent.py` | 10,000 | Per call. |

The database path is hard-coded to `deep_reading.db` in [backend/store/sessions.py](backend/store/sessions.py) (`DB_PATH`). Change the working directory to use a different file.

---

## 11. Security and safety considerations

- **FTS5 query injection** — neutralised by `_fts5_safe`; every LLM-generated `search_document` query is tokenised and quoted.
- **File path safety** — uploads are always written to a `NamedTemporaryFile`. The user's original filename is carried as a separate argument; downstream code never uses it for disk I/O.
- **Hook / shell command execution** — there is none. The app does not spawn child processes for document processing; PDF / DOCX parsing is in-process.
- **CORS** — locked to `http://localhost:3000` and `http://127.0.0.1:3000`. Loosen only for deployments you control.
- **API key exposure** — the key is read from `os.environ` in the orchestrator modules. It is never logged, never sent to the frontend, and never written to disk.
- **Citation trust boundary** — subagent output is parsed for UUID citations but the backend does not validate that a cited chunk actually contains the claimed text. Users verify via the source drawer.
- **Prompt injection** — documents may contain adversarial text ("ignore prior instructions…"). The Lead system prompt pins the citation requirement, and subagents are restricted to `read_document_chunk` only, so the blast radius of a successful injection is limited to incorrect prose in the final answer — the system cannot exfiltrate, execute code, or reach external resources.

---

## 12. Performance notes

- **Parallel subagents** — `asyncio.gather` means the wall-clock time for N subagents is ≈ the slowest one, not the sum.
- **Prompt caching** — Anthropic ephemeral cache amortises the ~5–10K-token system prompts across a session.
- **FTS5** — sub-millisecond keyword search even on long documents; `bm25(chunks_fts)` scoring is built in.
- **Streaming** — the frontend renders deltas as they arrive; no buffering beyond the single React state update.
- **SQLite WAL** — allows concurrent reads alongside a writer; adequate for single-user operation. For multi-user, consider Postgres + pgvector.
- **Context compaction** — fires at 85%; the Haiku summariser is cheap (~4K tokens output max) and keeps the session alive indefinitely.

Known limits:

- Token counting is character-based and approximate. A more accurate count would use the `anthropic` SDK's token counter but adds RTT per measurement.
- The Lead's document index is capped at 50 chunks. For very large documents, the Lead relies on `search_document` for the rest.
- Only one document at a time is typically searched; `search_document` requires a `document_id`.

---

## 13. Extending the system

### Adding a Lead tool

1. Append a schema to `LEAD_TOOLS` in [backend/orchestrator/tools.py](backend/orchestrator/tools.py).
2. Add a branch to `handle_tool(...)` that performs the work and returns a JSON-serialisable dict.
3. If the tool has a user-visible side effect, publish an appropriate SSE event in the Lead loop (e.g. an `artifact_written`-style event).
4. Update the Lead system prompt if the tool changes the workflow.

### Adding an SSE event type

1. Publish the event with `bus.publish("my_event", field=...)` in backend code.
2. If it should survive reloads, add the type to `_PERSIST_TYPES` in [backend/orchestrator/event_bus.py](backend/orchestrator/event_bus.py) and extend `persistedToTrace` in the session page.
3. Add a union member to `SSEEvent` in [frontend/lib/sse.ts](frontend/lib/sse.ts) and a handler in `attachStream`.

### Adding a new document format

1. Extend `DocumentLoader.load_document` in [document_loader.py](document_loader.py) with a new branch and a `page_count` / `content` return shape.
2. If the format has structural metadata (chapters, pages), have `DocumentChunker.smart_chunk` surface it in per-chunk metadata.
3. Add the extension to the file-input `accept` attribute on the home and upload UIs and to the supported-formats table in [README.md](README.md).

---

## 14. Testing

There is no automated test suite in this revision. Manual test checklist:

- Splash → Home → Session flow with drag-drop upload and a Haiku-only run (cheapest).
- Citation click opens the source drawer with the correct passage.
- Artifact write opens the preview canvas; Markdown / HTML / CSV all render.
- Retry and Edit truncate history server-side (verify via `GET /api/sessions/{id}`).
- Reload mid-session; trace replays via `GET /api/sessions/{id}/trace`.
- Manual compaction fires a `compaction_done` event and reduces `/context` token count.
- CLI `--interactive` round-trip with `--verbose` prints agent events.

Future work: pytest around `handle_tool`, deterministic fixtures for the chunker, and a mocked `anthropic.AsyncAnthropic` to exercise `run_lead` without network calls.
