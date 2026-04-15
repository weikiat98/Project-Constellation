# Architecture — Deep-Reading Assistant

## Overview

The Deep-Reading Assistant is a full-stack multi-agent system optimised for deep analysis of a known document (legal Acts, regulations, academic papers, compliance frameworks), not corpus-wide retrieval. The architecture is split into three layers: **Frontend**, **Backend API**, and **Agent Orchestration**.

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
│  POST /sessions/{id}/documents  (ingest pipeline)                │
│  POST /sessions/{id}/messages   (kicks off agent run)            │
│  GET  /sessions/{id}/stream     (SSE event stream)               │
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
│  └── tool: finalize                                              │
│                                                                  │
│  SubAgent (per task, isolated context window)                    │
│  └── tool: read_document_chunk                                   │
└──────────────────────────────▲──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  SQLite (aiosqlite + FTS5)                                       │
│                                                                  │
│  sessions · messages · documents · chunks · chunks_fts           │
│  definitions · cross_refs · artifacts · agent_runs              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component details

### Frontend (`frontend/`)

Built with Next.js 15 App Router, React 19, Tailwind CSS.

#### Three-pane layout

| Pane | Component | Responsibility |
| ---- | --------- | -------------- |
| Left sidebar | `UploadZone` | Drag-and-drop document upload, document list |
| Centre | `ChatPane` | Streaming messages, citation links, artifact cards, input box |
| Right | `AgentTrace` | Live tree of agent spawns, tool calls, artifact writes |

#### Key components

- **[ChatPane](frontend/components/ChatPane.tsx)** — renders messages with `react-markdown`. Parses `[uuid]` citation tokens inline and replaces them with `CitationLink` buttons.
- **[AgentTrace](frontend/components/AgentTrace.tsx)** — consumes SSE events and builds a collapsible event log. Expandable entries show tool inputs and agent summaries.
- **[CitationLink](frontend/components/CitationLink.tsx)** — clickable `[chunk_id]` badge that opens `SourceDrawer`.
- **[SourceDrawer](frontend/components/SourceDrawer.tsx)** — slide-in panel fetching the raw source chunk from `/api/chunks/{id}` for verification.
- **[AudienceToggle](frontend/components/AudienceToggle.tsx)** — switches between layperson / professional / expert; sent with every message.
- **[ContextMeter](frontend/components/ContextMeter.tsx)** — polls `/api/sessions/{id}/context` and receives live `context_usage` SSE events. Colour-coded bar + Compact button (amber ≥ 70%, red ≥ 90%).

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

---

### Persistence (`backend/store/`)

#### SQLite schema

```sql
sessions       (id, title, created_at)
messages       (id, session_id, role, content, token_usage, created_at)
documents      (id, session_id, filename, chunk_count)
chunks         (id, document_id, idx, content, metadata, section_id, page)
chunks_fts     FTS5 virtual table mirroring chunks.content
definitions    (id, document_id, term, definition, source_chunk_id)
cross_refs     (id, document_id, from_chunk_id, to_section_id)
artifacts      (id, session_id, name, content, mime_type, citations_json)
agent_runs     (id, session_id, parent_agent_id, role, status, tokens_in, tokens_out)
```

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
