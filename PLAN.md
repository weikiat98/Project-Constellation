# Constellation — Full-Stack Plan

> **Historical design document.** This plan was written before the 2.0 rewrite. Phase A is fully implemented and shipped (v2.0–v2.3). Phase B remains the forward roadmap. References to files removed in 2.0 (`librarian_agents_team.py`, `advanced_examples.py`, `test_example.py`) are preserved for historical context only.

## Context

The repo originally contained a CLI-only, synchronous Python prototype (`librarian_agents_team.py`, removed in 2.0) that orchestrated a Lead agent and three hardcoded SubAgents against Anthropic's Messages API. The goal was to evolve this into **Constellation**, a multi-agent document analysis assistant for lengthy, high-stakes documents — academic research papers, public policies, regulations, legal Acts, and compliance frameworks. That evolution is now complete.

### Who this is for and what they need

The target user is reading *a* document (or a small related set — e.g., an Act + its amendments + a guidance note), not searching across a vast corpus. The value is making dense, technical writing **understandable, navigable, and verifiable**:

- **Understandable** — plain-language rewrites at adjustable expertise levels.
- **Navigable** — cross-reference resolution, glossary lookup, jump-to-section.
- **Verifiable** — every claim links back to its source span; no unverified paraphrase.
- **Actionable** — extract obligations/findings into structured tables; compare versions.

This is the **depth axis** of multi-agent document work, not the breadth/corpus axis. A typical session involves 1–5 documents, not 10,000. This framing drives every architectural choice below — notably, **no vector database is required for the core product**.

### Why this is not (yet) a RAG system

RAG — retrieval-augmented generation over a persistent, cross-session corpus — solves a different problem: "find relevant snippets across many documents." That's the breadth axis. This system is optimized for deep transformation of a known document. Retrieval becomes relevant only if and when a user says *"I have 50 regulations, find ones that say anything about X"* — at which point a dedicated phase adds it. Until then, building RAG infrastructure is premature.

### Confirmed design decisions

- Subagents spawned **dynamically via tool use** (orchestrator-workers pattern).
- Frontend: **Next.js 15 + shadcn/ui**.
- Persistence: **SQLite + local filesystem** (swappable later; sufficient for the depth-axis use case).
- **CLI retained**, repointed to the new async engine.
- **Fidelity first**: every agent output must cite source spans. Hallucination on legal/policy text is the primary risk to manage.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 15 + React + Tailwind + shadcn/ui)      │
│  - Chat UI, file upload, live agent trace panel            │
│  - SSE stream for agent events                             │
└──────────────────────────────▲─────────────────────────────┘
                               │  HTTPS + SSE
┌──────────────────────────────▼─────────────────────────────┐
│  Backend (FastAPI + async)                                 │
│  - REST: /upload, /sessions, /messages                     │
│  - SSE: /sessions/{id}/stream                              │
│  - SQLite (sessions, messages, artifacts)                  │
└──────────────────────────────▲─────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────┐
│  Agent Orchestration (anthropic SDK, async)                │
│  - LeadOrchestrator: planner + tool use                    │
│  - SubAgent pool: spawned per-task, parallel via           │
│    asyncio.gather                                          │
│  - Shared: DocumentStore, PromptCache, EventBus            │
└────────────────────────────────────────────────────────────┘
```

---

## Backend Design

### Agent orchestration (replaces [librarian_agents_team.py](librarian_agents_team.py))

Follow Anthropic's **orchestrator-workers pattern** (docs: "Building effective agents"):

- **LeadOrchestrator** runs an agent loop with **tool use**. Its tools:
  - `spawn_subagent(role, task, context_refs)` — dispatches a subagent; returns a handle.
  - `read_document_chunk(chunk_id)` — pulls from DocumentStore.
  - `search_document(query)` — **within-document** keyword/BM25 lookup over chunks (SQLite FTS5). Scoped to the loaded document(s), not a global corpus.
  - `resolve_reference(section_id)` — fetches an internally-cross-referenced section (e.g., "subject to Section 4(2)").
  - `lookup_definition(term)` — fetches a defined term from the document's definitions section.
  - `write_artifact(name, content)` — persists intermediate results (with source citations).
  - `finalize(result)` — ends the session.
- **SubAgents** are **not hardcoded roles** — the Lead writes a role description per spawn (e.g., "extract all obligations this regulation imposes on small businesses, with section reference and penalty"). Each subagent runs its own Messages API call with its own tools.
- **Parallelism**: `asyncio.gather` over spawned subagents. Lead waits, then synthesizes.
- **Context isolation**: each subagent receives only the chunks it needs — keeps context windows small and costs down.
- **Prompt caching**: cache document chunks (1h TTL, `cache_control: ephemeral`) so repeated subagent calls over the same document are cheap. Cache per-subagent system prompts too.
- **Streaming**: `client.messages.stream()` on Lead and SubAgents; deltas pushed to the EventBus.
- **Subagent cloning**: Lead can spawn N subagents with *identical* role + instructions but different tasks/chunk refs (e.g., 8 parallel summarizers, one per chunk range). Core win of dynamic topology over fixed roles.
- **Per-agent context management**: every subagent is a fresh Messages call with an isolated window — system prompt (cached) + only the chunk IDs it needs. No cross-subagent history.
- **Lead-side compaction**: when Lead context crosses ~70% of the 200K window, compaction condenses older turns into a structured memory summary. Artifacts live in the DB and are referenced by ID, not re-embedded. Auto-trigger at 85%.
- **Citation enforcement**: subagent system prompts require every factual claim to carry a source reference (chunk_id + section/page). The Lead rejects subagent output missing citations and respawns the task.

### Tech stack

- **FastAPI** (async) + **uvicorn**
- **anthropic** Python SDK (async client)
- **SQLite** via `aiosqlite` with **FTS5** for within-document keyword search. Schema:
  - `sessions` (id, created_at, title)
  - `messages` (id, session_id, role, content, token_usage, created_at)
  - `documents` (id, session_id, filename, chunk_count)
  - `chunks` (id, document_id, index, content, metadata, section_id, page)
  - `chunks_fts` (FTS5 virtual table mirroring chunks.content)
  - `definitions` (id, document_id, term, definition, source_chunk_id)
  - `cross_refs` (id, document_id, from_chunk_id, to_section_id)
  - `artifacts` (id, session_id, name, content, mime_type, citations_json)
  - `agent_runs` (id, session_id, parent_agent_id, role, status, tokens_in, tokens_out)
- **Local filesystem** for uploaded documents
- **SSE** for streaming agent events (simpler than WebSockets for one-way push)
- **pydantic v2** for schemas
- Reuse: [document_loader.py](document_loader.py), [document_chunker.py](document_chunker.py)

### Key API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sessions` | Create a chat session |
| POST | `/api/sessions/{id}/documents` | Upload document (multipart); loader + chunker + definition/cross-ref extractor run |
| POST | `/api/sessions/{id}/messages` | Submit user prompt; kicks off agent run |
| GET | `/api/sessions/{id}/stream` | SSE stream: agent events |
| GET | `/api/sessions/{id}` | Session history + artifacts |
| GET | `/api/sessions/{id}/context` | Current Lead token usage + % of window |
| POST | `/api/sessions/{id}/compact` | Manually trigger Lead-context compaction |
| GET | `/api/artifacts/{id}` | Download generated artifact |

### Event schema (SSE)

```json
{ "type": "agent_spawned", "agent_id": "...", "role": "...", "parent": "lead" }
{ "type": "text_delta", "agent_id": "...", "delta": "..." }
{ "type": "tool_use", "agent_id": "...", "tool": "read_document_chunk", "input": {...} }
{ "type": "artifact_written", "artifact_id": "...", "name": "..." }
{ "type": "agent_done", "agent_id": "...", "summary": "..." }
{ "type": "run_complete", "final": "..." }
{ "type": "context_usage", "tokens": 68000, "window": 200000, "percent": 34 }
{ "type": "compaction_done", "before_tokens": 170000, "after_tokens": 42000 }
```

### Critical backend files (new)

- `backend/app.py` — FastAPI app + routes
- `backend/orchestrator/lead.py` — LeadOrchestrator with tool loop
- `backend/orchestrator/subagent.py` — SubAgent runner
- `backend/orchestrator/tools.py` — tool definitions + handlers
- `backend/orchestrator/event_bus.py` — in-process pub/sub for SSE
- `backend/orchestrator/compactor.py` — Lead-context compaction pass
- `backend/store/documents.py` — DocumentStore (wraps existing loader/chunker, adds FTS indexing)
- `backend/store/sessions.py` — SQLite session persistence
- `backend/extractors/definitions.py` — pull defined-term sections from uploaded doc
- `backend/extractors/cross_refs.py` — detect "Section X", "Article Y" patterns
- `backend/models.py` — pydantic schemas

Keep [document_loader.py](document_loader.py), [document_chunker.py](document_chunker.py) at repo root; import from `backend/`.

---

## Frontend Design

### Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **lucide-react** icons
- **react-markdown** + **rehype-highlight** for rendering agent output
- Native **EventSource** for SSE

### Layout

Three-pane layout:

```
┌────────────┬──────────────────────┬──────────────────┐
│ Sessions   │  Chat (main)         │  Agent Trace     │
│ sidebar    │  - messages          │  - live tree of  │
│ - new chat │  - file upload zone  │    agents &      │
│ - history  │  - input box         │    tool calls    │
│            │  - artifacts inline  │  - collapsible   │
└────────────┴──────────────────────┴──────────────────┘
```

### UX principles

- **Drag-and-drop upload** with progress, page count preview, per-file chunk stats.
- **Streaming first**: every agent token streams into the chat; trace panel updates live.
- **Citation-forward rendering**: every factual claim in agent output is a clickable link to the source chunk (opens a side drawer showing the original passage with the cited span highlighted).
- **Audience-level toggle**: each response has a "Explain as: layperson / professional / expert" selector that re-renders the passage at that level.
- **Transparency without noise**: trace panel is collapsible; default shows compact "3 agents working…" indicator.
- **Artifacts**: tables, summaries, extracted obligation lists render inline with download buttons.
- **Interruptibility**: Stop button cancels the run.
- **Resume**: sessions persist — reload the page, pick up the history.
- **Context meter**: header strip shows live Lead-context usage — `Context: 34% (68K / 200K)`. Color-coded (green < 70%, amber 70–90%, red > 90%). **Compact** button next to it.

### Critical frontend files (new)

- `frontend/app/layout.tsx` — root layout + theme
- `frontend/app/sessions/[id]/page.tsx` — main chat view
- `frontend/components/ChatPane.tsx`
- `frontend/components/AgentTrace.tsx` — renders SSE event tree
- `frontend/components/UploadZone.tsx`
- `frontend/components/ArtifactCard.tsx`
- `frontend/components/CitationLink.tsx` — inline citation with drawer
- `frontend/components/SourceDrawer.tsx` — shows original passage with highlight
- `frontend/components/AudienceToggle.tsx` — layperson/professional/expert selector
- `frontend/components/ContextMeter.tsx` — live token-usage bar + Compact button
- `frontend/lib/sse.ts` — typed EventSource wrapper
- `frontend/lib/api.ts` — fetch helpers

---

## Migration of existing code

> All actions below have been completed as of v2.0.

| Existing file | Action | Status |
| --- | --- | --- |
| [document_loader.py](document_loader.py) | **Keep**, import from backend | Done — at repo root, imported by `backend/store/documents.py` |
| [document_chunker.py](document_chunker.py) | **Keep**, import from backend | Done — at repo root, imported by `backend/store/documents.py` |
| `librarian_agents_team.py` | **Replaced** with async orchestrator | Removed in 2.0 |
| [cli.py](cli.py) | **Keep**, repoint to new async orchestrator | Done — drives `run_lead` directly |
| `advanced_examples.py`, `test_example.py` | Repurpose as integration tests | Removed in 2.0 (no replacement yet — see §14 of technical_docs.md) |

---

## Implementation phases

Phases are split into **Phase A (build now)** — the core Constellation product, sufficient as an end-state for the target use case — and **Phase B (build later, on-demand)** — additions triggered by specific user needs, not speculation.

### Phase A — Build now (core Constellation)

These phases deliver the complete value proposition for academic papers, policies, regulations, and compliance docs. Build in order; each produces a demoable deliverable.

**A1. Backend scaffold**
FastAPI app, SQLite schema (including FTS5), document upload + chunk pipeline wired to existing loader/chunker. Definition and cross-reference extractors run at ingest time.
*Deliverable: POST a PDF, GET back chunks + extracted definitions + detected cross-refs.*

**A2. Async orchestrator with citation enforcement**
LeadOrchestrator with tool use + dynamic SubAgent spawn via `asyncio.gather`. Prompt caching on chunks. Streaming. Citation validation: subagent outputs rejected if claims lack chunk references.
*Deliverable: end-to-end CLI run against the new async engine, every claim carries a citation.*

**A3. Document-navigation tools**
Implement `search_document` (SQLite FTS5, within-document only), `resolve_reference`, `lookup_definition`. Lead uses these instead of reading whole document linearly.
*Deliverable: Lead efficiently answers "what does Section 4(2) say" without loading all chunks.*

**A4. SSE event bus**
Wire agent events to `/stream`.
*Deliverable: `curl` the stream and see live events.*

**A5. Frontend scaffold**
Next.js app, three-pane layout, session list, upload zone (no streaming yet).

**A6. Live chat + trace + citations**
SSE consumer, streaming renderer, agent trace tree. **Citation links** render inline; clicking opens source drawer with the original passage highlighted.
*Deliverable: user uploads a 200-page regulation, asks a question, sees cited answer, clicks citation to verify against source.*

**A7. Audience-level rewrites**
Layperson / professional / expert toggle per response. Subagent role varies system prompt by audience level.
*Deliverable: same regulation passage explained three ways.*

**A8. Structured extraction artifacts**
Extract-to-table subagent (reuses existing SubAgent 3 concept). "List every obligation with section reference and penalty" → downloadable CSV/HTML.
*Deliverable: compliance obligation table exported from a real regulation.*

**A9. Hardening**
Simple API key auth, rate limits, error surfaces, token-usage display, Stop/Resume, integration tests.

At the end of Phase A, Constellation is a complete, useful product. **Most users will never need anything beyond this.**

### Phase B — Build later, triggered by specific user needs

Do not build these speculatively. Each is triggered by an observed user request or bottleneck.

**B1. Document comparison (trigger: "compare this Act with its amendment")**
Load 2+ documents into one session; diff-aware subagent surfaces what changed, section by section. Mostly orchestration work — schema already supports multiple documents per session.

**B2. Structured-data uploads (trigger: user tries to upload xlsx/csv)**
Add **DuckDB** alongside SQLite for tabular data. New tool: `query_tables(sql)`. Text-to-SQL subagent for natural-language queries over uploaded spreadsheets. Use case: compliance checklists, datasets referenced by a policy doc.

**B3. Within-document semantic search (trigger: FTS5 keyword search misses relevant passages)**
Add embeddings *per document* using `sqlite-vec`. Still no vector DB — embeddings live in the same SQLite file, scoped to one document. `search_document` becomes hybrid (BM25 + vector). Only needed if keyword recall proves insufficient in practice.

**B4. Cross-session document library (trigger: user says "I want to reuse documents I uploaded last week")**
Decouple documents from sessions. Add a "library" view. Still no cross-document retrieval — just persistent per-document workspaces.

**B5. Cross-document retrieval / true RAG (trigger: user says "find which of my 50 regulations mention X")**
Only at this point does RAG become relevant. Add a real vector store (pgvector on Postgres is the natural migration — collapses relational + vector + FTS into one system). New tool: `search_corpus(query)` with document-level filters. This is a **major** shift — migrate off SQLite, add ingestion pipeline, embedding job queue.

**B6. Object storage / scale (trigger: local disk fills up or deployment needs multi-instance)**
Move uploaded files to S3/MinIO. Add Redis for cache and SSE session state. Split DB from app tier.

**B7. Advanced stores (trigger: specific features demand them)**
- **Graph DB** — only if users need cross-document entity relationships ("which contracts reference Company X *and* Clause 4.2"). Most deployments never need this.
- **Dedicated audit log** (ClickHouse, etc.) — only at compliance/enterprise scale.

### What's deliberately excluded

- **Multi-user / team features** — single-user tool until a real collaboration request emerges.
- **Mobile app** — web frontend is sufficient; reading 200-page PDFs on mobile is not the workflow.
- **Offline mode** — Anthropic API is required; no local LLM fallback planned.
- **Vector DB on day one** — per the Context section, premature for the depth-axis use case.

---

## Verification

### Phase A verification

- **Unit**: chunker + loader tests (already exist); add orchestrator tool-handler tests with a mocked Anthropic client; test citation-validation rejects uncited subagent output.
- **Integration**: run a 200-page PDF (real policy or regulation) through the full stack; assert subagent spawn, parallel execution, final artifact, every claim has a valid citation.
- **Manual E2E**: upload a real Act in the browser, ask "what obligations does this impose on small businesses," verify the returned table's citations each resolve to the correct sections when clicked.
- **Audience levels**: same question answered at layperson/professional/expert — verify vocabulary and detail genuinely differ.
- **Cache hit rate**: log `cache_read_input_tokens` — expect high hit rates on repeated subagent calls over the same document.
- **Load**: run two long documents concurrently in separate sessions; confirm no cross-session leakage and SSE streams stay distinct.

### Phase B verification (per feature, when built)

Each Phase B feature ships with its own integration test proving the triggering user need is now served. No speculative test coverage — if the feature isn't built, the test isn't written.
