# Architecture — Constellation

## Overview

Constellation is a full-stack multi-agent system optimised for deep analysis of a known document (legal Acts, regulations, academic papers, compliance frameworks), not corpus-wide retrieval. The architecture is split into three layers: **Frontend**, **Backend API**, and **Agent Orchestration**.

---

## System diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│  Browser  (Next.js 15 + React 19 + Tailwind)                    │
│                                                                 │
│  ┌───────────────┐  ┌───────────────────────┐  ┌─────────────┐ │
│  │ Sessions list │  │  Chat pane            │  │ Agent Trace │ │
│  │ Upload zone   │  │  - streaming messages │  │ - live tree │ │
│  │               │  │  - citation links     │  │ - tool calls│ │
│  └───────────────┘  │  - artifact cards     │  │ - collapsible│ │
│                     │  - audience toggle    │  └─────────────┘ │
│                     │  - context meter      │                  │
│                     └───────────────────────┘                  │
└──────────────────────────────▲──────────────────────────────────┘
                               │  REST + SSE
┌──────────────────────────────▼──────────────────────────────────┐
│  FastAPI (async, uvicorn)                                        │
│                                                                  │
│  POST /sessions          GET  /sessions/{id}                     │
│  PATCH /sessions/{id}    DELETE /sessions/{id}                   │
│  DELETE /sessions/{id}/messages/after/{mid}  (edit/retry)        │
│  POST /sessions/{id}/documents  (ingest pipeline)                │
│  DELETE /sessions/{id}/documents/{did}  (refused if referenced)  │
│  POST /sessions/{id}/messages   (kicks off agent run)            │
│  GET  /sessions/{id}/stream     (SSE event stream)               │
│  GET  /sessions/{id}/trace      (replay persisted trace)         │
│  GET  /sessions/{id}/context    (token usage)                    │
│  POST /sessions/{id}/compact    (manual compaction)              │
│  POST /sessions/{id}/count_tokens  (pre-send estimate)           │
│  GET  /api/chunks/{id}          (source drawer)                  │
│  GET  /api/artifacts/{id}                                        │
└──────────────────────────────▲──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  Agent Orchestration                                             │
│                                                                  │
│  LeadOrchestrator                                                │
│  ├── tool: search_document (FTS5, within-document)              │
│  ├── tool: read_document_chunk                                   │
│  ├── tool: resolve_reference  (cross-ref → chunk)               │
│  ├── tool: lookup_definition                                     │
│  ├── tool: spawn_subagent  ──► asyncio.gather ──► N subagents   │
│  ├── tool: write_artifact                                        │
│  ├── tool: advisor  (optional; enabled via ADVISOR_MODEL env)   │
│  └── tool: finalize                                              │
│                                                                  │
│  SubAgent (per task, isolated context window)                    │
│  └── tool: read_document_chunk                                   │
└──────────────────────────────▲──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  SQLite (aiosqlite + FTS5)                                       │
│                                                                  │
│  sessions (+ last_run_state) · messages (+ attached docs)        │
│  documents · chunks · chunks_fts                                 │
│  definitions · cross_refs · artifacts · agent_runs               │
│  trace_events  (persisted SSE events, replayed on reload)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component details

### Frontend (`frontend/`)

Built with Next.js 15 App Router, React 19, Tailwind CSS.

#### Layout

| Pane | Component | Responsibility |
| ---- | --------- | -------------- |
| Left sidebar | `ChatSidebar` | Sessions list; pin, rename, delete |
| Centre | `ChatPane` | Streaming messages + Thinking panel, citation links, artifact cards, composer with inline `TokenCounter` |
| Right dock | `AgentTracePanel` → `AgentTrace` | Live tree of agent spawns, tool calls, artifact writes, compaction |
| Slide-in | `ArtifactPreview` | MD / HTML / CSV / plain-text artifact canvas (sibling of chat, not overlay) |
| Slide-in | `SourceDrawer` | Source chunk viewer for citation clicks |
| In-session | `UploadZone` + `SessionFiles` | Drag-drop upload and per-session file menu |

#### Key components

- **[ChatPane](frontend/components/ChatPane.tsx)** — renders messages with `react-markdown`. Parses `[uuid]` citation tokens inline and replaces them with `CitationLink` buttons.
- **[AgentTrace](frontend/components/AgentTrace.tsx)** — consumes SSE events and builds a collapsible event log. Expandable entries show tool inputs and agent summaries.
- **[CitationLink](frontend/components/CitationLink.tsx)** — clickable `[chunk_id]` badge that opens `SourceDrawer`.
- **[SourceDrawer](frontend/components/SourceDrawer.tsx)** — slide-in panel fetching the raw source chunk from `/api/chunks/{id}` for verification.
- **[AudienceToggle](frontend/components/AudienceToggle.tsx)** — switches between layperson / professional / expert; sent with every message.
- **[ContextMeter](frontend/components/ContextMeter.tsx)** — polls `/api/sessions/{id}/context` and receives live `context_usage` SSE events. Colour-coded bar + Compact button (amber ≥ 70%, red ≥ 90%).
- **[TokenCounter](frontend/components/TokenCounter.tsx)** — inline pre-send estimator that calls `POST /api/sessions/{id}/count_tokens` (backed by Anthropic's free `count_tokens`) and shows `prompt + base` tokens before the user hits send. Accounts for system prompt, tools, 50-chunk doc index, and chat history.

#### Data flow

```text
User submits message
  → api.sendMessage()  POST /messages
  → Backend creates task, returns immediately (202)
  → Frontend opens EventSource on /stream
  → SSE events update: streamingText, traceEntries, artifacts
  → run_complete closes the stream, final message committed to state
```

#### SSE client ([`frontend/lib/sse.ts`](frontend/lib/sse.ts))

Typed `EventSource` wrapper. Maps raw JSON events to discriminated union `SSEEvent`. Closes on `run_complete` or `error`.

---

### Backend API (`backend/app.py`)

FastAPI async application. All endpoints are non-blocking. Agent runs execute as `asyncio` background tasks; the HTTP response is returned immediately (202).

#### Document ingest pipeline

```text
POST /sessions/{id}/documents
  → DocumentStore.ingest()
      → DocumentLoader.load_document()   (PDF/DOCX/TXT/MD/HTML)
      → DocumentChunker.smart_chunk()    (pages → chapters → sections)
      → insert_chunk() × N              (SQLite + FTS5 trigger)
  → asyncio.create_task(extract_definitions())
  → asyncio.create_task(extract_cross_refs())
```

Extractors run in the background after the HTTP response is returned so upload latency is minimal.

#### SSE streaming

Each session has a `SessionEventBus` (an `asyncio.Queue`). The Lead and subagents call `bus.publish(event_type, **data)` synchronously; `StreamingResponse` drains the queue as `text/event-stream`.

---

### Agent orchestration

#### LeadOrchestrator (`backend/orchestrator/lead.py`)

Implements the **orchestrator-workers pattern** from Anthropic's agent design guide.

1. Receives user message + document chunk index.
2. Enters an agentic tool-use loop (max 40 iterations, safety limit).
3. On `spawn_subagent` tool calls: collects all spawns from the response, runs them with `asyncio.gather` for parallelism, injects results back as tool results.
4. On `finalize`: persists the assistant message, closes the loop.
5. Context compaction is checked at the top of every iteration via `maybe_compact()`.

**Prompt caching**: system prompt sent with `cache_control: ephemeral`. The chunk index is embedded in the first user message (also cached after the first call).

#### SubAgent (`backend/orchestrator/subagent.py`)

Each subagent is a completely fresh `messages.create` call:

- System prompt = role description + audience instruction + citation rule (cached).
- Context = only the chunk IDs passed by the Lead (minimal, isolated).
- Tools = `read_document_chunk` only.
- **Citation enforcement**: result text is regex-scanned for `[uuid]` patterns. If absent, `citations_present: false` is returned to the Lead which can choose to respawn.

**Cloning**: the Lead can spawn N identical-role subagents with different `chunk_ids` (e.g. 8 parallel summarisers, one per section range).

#### Tools (`backend/orchestrator/tools.py`)

| Tool | Handler | Description |
| ---- | ------- | ----------- |
| `read_document_chunk` | `get_chunk()` | Fetch full text of a chunk by UUID |
| `search_document` | `search_chunks()` | FTS5 BM25 search scoped to one document |
| `resolve_reference` | `get_chunk_by_section()` | Cross-ref → chunk (e.g. "Section 4(2)") |
| `lookup_definition` | `lookup_definition()` | Defined-term lookup from extracted glossary |
| `spawn_subagent` | intercepted in `lead.py` | Dynamic subagent spawn |
| `write_artifact` | `create_artifact()` | Persist named artifact with citations |
| `finalize` | intercepted in `lead.py` | End run, return answer |

#### Compactor (`backend/orchestrator/compactor.py`)

- **Auto-trigger**: when estimated token count exceeds 85% of 200K window.
- Sends the oldest turns (excluding the last 20%) to a compaction call that produces a structured summary of all tool calls, subagent results, and artifacts.
- Replaces the old turns with two synthetic messages (compacted summary + acknowledgement).
- Publishes `compaction_done` SSE event.

#### Advisor tool (optional)

Gated behind the `ADVISOR_MODEL` environment variable. When set (e.g. `claude-opus-4-7`), `_build_tools()` in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) appends an `advisor_20260301` beta tool to the Lead's toolset and switches the stream to `client.beta.messages.stream(...)` with the `advisor-tool-2026-03-01` beta header.

- `max_uses: 3` per run — matches the three natural decision points: planning, post-synthesis review, and pre-finalize quality gate.
- Advisor inference runs inside the same Messages call; results arrive as `advisor_tool_result` blocks in `response.content`.
- The Lead surfaces the advisor's text to the UI as a `thinking_delta` event prefixed with `[Advisor]` so the user sees the counsel live.
- Advisor token usage is accumulated into the Lead's `tokens_in` / `tokens_out` via `response.usage.iterations` so accounting is complete.

Leave `ADVISOR_MODEL` unset for strict cost control — the standard tool list is used and no advisor calls are made.

---

### Persistence (`backend/store/`)

#### SQLite schema

```sql
sessions       (id, title, created_at, pinned, audience, last_run_state)
messages       (id, session_id, role, content, token_usage, thinking,
                artifact_ids_json, attached_document_ids_json, created_at)
documents      (id, session_id, filename, original_filename, chunk_count)
chunks         (id, document_id, idx, content, metadata, section_id, page)
chunks_fts     FTS5 virtual table mirroring chunks.content
definitions    (id, document_id, term, definition, source_chunk_id)
cross_refs     (id, document_id, from_chunk_id, to_section_id)
artifacts      (id, session_id, name, content, mime_type, citations_json)
agent_runs     (id, session_id, parent_agent_id, role, status, tokens_in, tokens_out)
trace_events   (id, session_id, run_index, seq, event_type, payload, created_at)
```

`sessions.last_run_state` (`idle | running | completed | error`, added in 2.2) is the source of truth for whether an agent run is in flight. The frontend reads it on session mount and re-attaches the SSE stream when the value is `running`, enabling cross-session navigation without losing in-flight runs. `messages.attached_document_ids_json` (added in 2.2) preserves which documents the user attached *for that turn* so chip rendering survives reloads.

FTS5 is kept in sync with `chunks` via `AFTER INSERT / UPDATE / DELETE` triggers. Queries are scoped to `document_id` so search never crosses document boundaries.

#### DocumentStore (`backend/store/documents.py`)

Wrapper around the existing `document_loader.py` and `document_chunker.py` (kept at repo root). Calls `smart_chunk()` which auto-detects structure (page markers → chapter headers → paragraph sections) and persists each chunk with `section_id` and `page` metadata where available.

---

### Extractors (`backend/extractors/`)

Run once at ingest time as background tasks.

#### Definitions (`definitions.py`)

Regex patterns for legal/policy defined-term conventions:

```text
"term" means <definition>
"term" shall mean <definition>
"term" refers to <definition>
"term" is defined as <definition>
```

Results stored in `definitions` table, enabling `lookup_definition` tool.

#### Cross-references (`cross_refs.py`)

Detects `Section X`, `Article Y`, `Clause Z`, `Schedule N`, `Annex A` patterns and records `(from_chunk_id, to_section_id)` pairs. Enables `resolve_reference` tool.

---

## Design decisions

### No vector database

This system is optimised for depth over breadth — analysing 1–5 known documents rather than searching a corpus. SQLite FTS5 (BM25) is sufficient for within-document keyword recall. A vector store (Phase B) is only warranted when a user needs semantic search across 50+ documents.

### Dynamic subagent topology

Subagents are not hardcoded roles. The Lead writes a purpose-built role description per spawn, enabling arbitrary specialisation (obligation extractor, comparison analyst, plain-language rewriter, etc.) without code changes.

### Citation as a first-class constraint

Citation enforcement is architectural, not advisory. Subagent system prompts mandate `[chunk_id]` on every claim. The Lead receives a `citations_present` flag and can reject and respawn. The frontend renders citations as clickable links to the raw source passage.

### Prompt caching strategy

- Lead system prompt: cached (ephemeral, 1 h TTL).
- Subagent system prompts: cached per-subagent.
- Document chunk index (first user message): cached after first call, amortised across all subagents in a session.

### Run state lives on the session row, not in memory

Agent runs are background `asyncio.Task`s that don't observe HTTP-client disconnects. If the user navigates away mid-run, the task keeps going, the bus keeps publishing, and the queue keeps buffering. The frontend needs a way to detect this on remount.

Putting that signal in process memory (e.g. a `set[session_id]` of active runs) would not survive a backend restart and would require a separate inspection endpoint. Instead, `sessions.last_run_state` is set to `running` before the task is spawned and to `completed` / `error` in the task's `finally` block. The session-detail response already exists, so the frontend learns the state for free on its existing mount call. After detecting `running`, the page re-subscribes via the existing SSE endpoint — `EventBusRegistry.get_or_create` returns the still-open bus and `consume()` delivers the buffered tail.

### Final-message typewriter is gated by a deferred commit

The Lead emits `final_message` and `run_complete` back-to-back from the `finalize` branch. If the frontend processed `run_complete` naively — replacing the live streaming bubble with the persisted bubble — the typewriter animation would never run, because the live `streamingText` would be cleared within tens of milliseconds.

The fix is a single ref (`pendingCommitRef`) that holds the post-`run_complete` flush as a closure. The flush only runs when the typewriter's `onComplete` callback fires (i.e. `displayed.length === target.length`), guaranteeing the user sees the recap type out before the bubble hands off to its persisted form. The on-close handler short-circuits when a commit is pending so it can't clobber the live state on stream-end.

### SQLite over Postgres

Single-user, local-first deployment. SQLite with WAL mode handles concurrent async reads. FTS5 is built in. Migration to Postgres is straightforward if multi-instance deployment becomes necessary (Phase B6).

---

## File map

| File | Role |
| ---- | ---- |
| [backend/app.py](backend/app.py) | FastAPI routes |
| [backend/models.py](backend/models.py) | Pydantic v2 schemas |
| [backend/orchestrator/lead.py](backend/orchestrator/lead.py) | LeadOrchestrator loop |
| [backend/orchestrator/subagent.py](backend/orchestrator/subagent.py) | SubAgent runner |
| [backend/orchestrator/tools.py](backend/orchestrator/tools.py) | Tool definitions + dispatch |
| [backend/orchestrator/event_bus.py](backend/orchestrator/event_bus.py) | SSE pub/sub |
| [backend/orchestrator/compactor.py](backend/orchestrator/compactor.py) | Context compaction |
| [backend/store/sessions.py](backend/store/sessions.py) | SQLite CRUD + FTS5 schema |
| [backend/store/documents.py](backend/store/documents.py) | Document ingest pipeline |
| [backend/extractors/definitions.py](backend/extractors/definitions.py) | Definition extractor |
| [backend/extractors/cross_refs.py](backend/extractors/cross_refs.py) | Cross-reference extractor |
| [frontend/app/sessions/\[id\]/page.tsx](frontend/app/sessions/[id]/page.tsx) | Main session view |
| [frontend/components/ChatPane.tsx](frontend/components/ChatPane.tsx) | Streaming chat |
| [frontend/components/AgentTrace.tsx](frontend/components/AgentTrace.tsx) | Live event tree |
| [frontend/lib/sse.ts](frontend/lib/sse.ts) | Typed SSE client |
| [frontend/lib/api.ts](frontend/lib/api.ts) | Typed REST client |
| [document_loader.py](document_loader.py) | Multi-format file loader |
| [document_chunker.py](document_chunker.py) | Intelligent chunker |
| [cli.py](cli.py) | CLI (async orchestrator) |
| [UAT/25April_UAT Checklist.md](UAT/25April_UAT%20Checklist.md) | UAT v2.1 test pass + issue log |
| [UAT/25April_UAT_Resolution_Plan.md](UAT/25April_UAT_Resolution_Plan.md) | Per-issue root cause + resolution + verification (drives 2.2) |
