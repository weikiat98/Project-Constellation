# Deep-Reading Assistant

A full-stack multi-agentic system for deep analysis of lengthy and technical documents, ranging from legal regulations, academic papers to compliance frameworks using Anthropic API

Every agent output cites its source. Every claim is verifiable.

---

## Table of contents

- [What it does](#what-it-does)
- [Simplified architecture](#simplified-architecture)
- [Models and cost architecture](#models-and-cost-architecture)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Environment variables](#environment-variables)
- [Setup](#setup)
- [End-to-end walkthrough](#end-to-end-walkthrough)
- [CLI usage](#cli-usage)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)
- [SSE event types](#sse-event-types)
- [Supported document formats](#supported-document-formats)
- [Future phases](#future-phases-phase-b)

---

## What it does

When a user uploads a PDF, DOCX, or text document and asks questions in natural language, a Lead Orchestrator spawns specialised subagents in parallel, each working on a focused subtask with access only to the chunks it needs. The results provided by the sub-agents are synthesised and returned with inline citations by the Lead Orchestrator. The user can click inline citations to verify against the original text. The main objectives of this deep reading assistant are as such:

1. **Understandable**: plain-language rewrites at adjustable expertise levels (layperson / professional / expert).

2. **Navigable**: cross-reference resolution, glossary lookup, FTS5 keyword search within the document.

3. **Verifiable**: every factual claim links back to its source chunk. Subagent output without citations is flagged and rejected.

4. **Actionable**: extract obligations, findings, and comparisons into downloadable artifacts (Markdown, HTML, CSV).

---

## Simplified Architecture

```text
┌────────────────────────────────────────────────────────────┐
│  Frontend  (Next.js 15 + React 19 + Tailwind + shadcn/ui)  │
│  - Three-pane: Sessions | Chat + Artifacts | Agent Trace   │
│  - SSE consumer, streaming renderer, citation drawer       │
│  - Audience toggle, context meter, drag-and-drop upload    │
└──────────────────────────────▲─────────────────────────────┘
                               │  HTTPS + SSE
┌──────────────────────────────▼─────────────────────────────┐
│  Backend  (FastAPI + async uvicorn)                        │
│  - REST: /sessions, /documents, /messages, /artifacts      │
│  - SSE: /sessions/{id}/stream                              │
│  - SQLite (sessions, chunks, FTS5, definitions, artifacts) │
└──────────────────────────────▲─────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────┐
│  Agent Orchestration  (anthropic SDK, async)               │
│  - LeadOrchestrator: tool-use loop + compaction            │
│  - SubAgents: spawned dynamically, parallel via gather     │
│  - Prompt caching on document chunks (1 h TTL)             │
│  - Citation enforcement: rejects uncited subagent output   │
└────────────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed component documentation.

---

## Models and cost architecture

The system uses **two different Claude models** for a deliberate cost/quality tradeoff:

| Role | Default model | Rationale |
| --- | --- | --- |
| Lead Orchestrator (`lead.py`) | `claude-opus-4-6` | High-capability reasoning, tool-use orchestration, synthesis |
| SubAgents (`subagent.py`) | `claude-haiku-4-5-20251001` | Fast and cheap; each subagent does a narrow, citation-bounded task |
| Compactor (`compactor.py`) | `claude-haiku-4-5-20251001` | Context summarisation — no complex reasoning needed |

Both defaults can be overridden with the `ANTHROPIC_MODEL` environment variable (see [Environment variables](#environment-variables)). Setting `ANTHROPIC_MODEL` changes **all three roles** to the same model — useful for cost control or testing, but will reduce Lead quality if set to Haiku.

---

## Project structure

```text
deep-reading-assistant/
│
├── backend/                        # FastAPI application
│   ├── app.py                      # Routes: sessions, documents, messages, SSE, artifacts
│   ├── models.py                   # Pydantic v2 schemas
│   ├── orchestrator/
│   │   ├── lead.py                 # LeadOrchestrator agentic loop (claude-opus-4-6)
│   │   ├── subagent.py             # SubAgent runner (claude-haiku-4-5-20251001, parallel)
│   │   ├── tools.py                # Tool definitions + handlers
│   │   ├── event_bus.py            # Per-session SSE pub/sub
│   │   └── compactor.py            # Lead-context compaction (claude-haiku-4-5-20251001)
│   ├── store/
│   │   ├── sessions.py             # SQLite: sessions, messages, chunks, artifacts
│   │   └── documents.py            # DocumentStore (ingest → chunk → FTS index)
│   └── extractors/
│       ├── definitions.py          # Defined-term extractor (legal/policy patterns)
│       └── cross_refs.py           # Section cross-reference detector
│
├── frontend/                       # Next.js 15 application
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Home: session list + new session
│   │   └── sessions/[id]/page.tsx  # Main chat view (three-pane)
│   ├── components/
│   │   ├── ChatPane.tsx            # Streaming chat with inline citation links
│   │   ├── AgentTrace.tsx          # Live agent event tree (collapsible)
│   │   ├── UploadZone.tsx          # Drag-and-drop file upload
│   │   ├── ArtifactCard.tsx        # Inline artifact with download button
│   │   ├── CitationLink.tsx        # Clickable [chunk_id] citation
│   │   ├── SourceDrawer.tsx        # Slide-in drawer showing source passage
│   │   ├── AudienceToggle.tsx      # Layperson / Professional / Expert selector
│   │   └── ContextMeter.tsx        # Live token-usage bar + Compact button
│   └── lib/
│       ├── api.ts                  # Typed fetch helpers
│       └── sse.ts                  # Typed EventSource wrapper
│
├── document_loader.py              # Multi-format document loader (PDF, DOCX, TXT, MD, HTML)
├── document_chunker.py             # Intelligent chunker (pages, chapters, sections)
├── cli.py                          # CLI — standalone, no backend server required
├── requirements.txt                # Python dependencies
│
├── librarian_agents_team.py        # Original synchronous prototype (kept for reference)
├── advanced_examples.py            # Scenario demos using the original sync prototype
└── test_example.py                 # Full workflow demo using the original sync prototype
```

---

## Requirements

### Backend

- Python 3.11+
- `ANTHROPIC_API_KEY` environment variable

### Frontend

- Node.js 20+

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key. Obtain one at [console.anthropic.com](https://console.anthropic.com). |
| `ANTHROPIC_MODEL` | No | see below | Override the Claude model for all agent roles. Defaults to `claude-opus-4-6` for the Lead and `claude-haiku-4-5-20251001` for subagents and the compactor. Setting this variable applies the same model to all three. |

Example — run everything on Haiku for minimal cost (lower quality):

```bash
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

---

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

**Optional dependencies:** `PyPDF2` (PDF support) and `python-docx` (DOCX support) are listed in `requirements.txt` and installed by default. If either is missing, loading those file types will fail with an `ImportError`. Plain-text, Markdown, and HTML files work without them.

### 2. Set environment variables

#### Linux / macOS

```bash
export ANTHROPIC_API_KEY='your-key-here'
```

#### Windows

```bat
setx ANTHROPIC_API_KEY "your-key-here"
```

Then restart your terminal.

### 3. Start the backend

> **Important:** run this command from the **repo root**, not from inside `backend/`.
>
> The app is structured as a Python package: `backend/` contains an `__init__.py`, so its modules import each other as `from backend.orchestrator.lead import ...`. When you run `uvicorn` from the repo root, Python adds the repo root to `sys.path`, which means `backend` is a discoverable package. If you `cd backend` first and then run `uvicorn app:app`, Python sees the current directory (`backend/`) on the path instead — there is no `backend` package visible from there, so every cross-module import fails with `ModuleNotFoundError: No module named 'backend'`.

```bash
uvicorn backend.app:app --reload --port 8000
```

The SQLite database (`deep_reading.db`) is created automatically on first run.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Close the frontend and Backend

Press Ctrl + C to close both the frontend and backend


---

## End-to-end walkthrough

This section shows what a full session looks like, from document upload to cited answer.

### Step 1 — Upload a document

In the web UI: open a new session, drag your PDF/DOCX/TXT onto the upload zone.

In the backend, this triggers:

- The file is loaded, chunked (~8000 chars/chunk), and stored in SQLite with an FTS5 full-text index.
- Defined terms (e.g. "Licensee", "Effective Date") are extracted automatically.
- Internal cross-references (e.g. "see Section 4.2") are detected and indexed.

### Step 2 — Ask a question

Type your question in the chat pane. The backend's `/api/sessions/{id}/messages` endpoint starts the agent run.

**What you see in the UI:**

- The Agent Trace pane (right) lights up with `agent_spawned` events as the Lead and subagents start.
- The Context Meter bar shows token usage growing in real time.
- Tool-use events appear in the trace (`search_document`, `spawn_subagent`, etc.).

**What happens inside:**

1. The Lead receives your question plus a 50-chunk index of the document.
2. It searches and reads chunks to understand structure.
3. It spawns 2–5 subagents in parallel, each assigned a focused subtask (e.g. "extract obligations in §3", "find definitions in §1").
4. Subagents run concurrently via `asyncio.gather`, each with only the chunk IDs it needs.
5. The Lead validates that every subagent result contains `[chunk_id]` citations; uncited results are flagged.
6. The Lead synthesises all results and calls `finalize` with the cited answer.

### Step 3 — Read the answer and verify claims

- Inline `[chunk_id]` citations are rendered as clickable links.
- Clicking a citation opens the Source Drawer with the exact passage from the document.
- Any generated artifacts (tables, obligation lists) appear as `ArtifactCard` components with a download button.

### Step 4 — Long sessions: automatic compaction

If the Lead's context reaches 85% of the 200K token window, compaction fires automatically:

- Earlier turns are condensed into a structured summary by the Haiku compactor.
- A `compaction_done` event updates the Context Meter.
- The session continues without interruption or data loss.

---

## CLI usage

The CLI runs the async orchestrator **directly** — it does **not** require the FastAPI backend or any server to be running. It is fully self-contained and uses the same SQLite store.

```bash
# Single question
python cli.py -i regulation.pdf -r "What obligations does this impose on small businesses?"

# Save answer to file
python cli.py -i policy.pdf -r "Summarise Part 3" -o summary.md

# Interactive Q&A mode with audience level
python cli.py -i act.pdf --interactive --audience layperson

# Verbose: show agent event trace
python cli.py -i paper.pdf -r "What are the main findings?" --verbose
```

Audience options: `layperson` | `professional` (default) | `expert`

---

## Reference files: advanced_examples.py and test_example.py

Both files demonstrate the **original synchronous prototype** (`librarian_agents_team.py`), not the current async orchestrator. They are useful as:

- **`advanced_examples.py`** — five scenario demos (large document summary, cross-reference resolution, multi-topic analysis, glossary extraction, comparative analysis). Run any function directly to see how the prototype handles a given task type.
- **`test_example.py`** — a full end-to-end workflow demo: creates a sample multi-chapter document, ingests it, runs several queries, and prints results. Useful as a smoke-test for the document loader and chunker in isolation.

To run either against the **current** system, replace the `LibrarianAgentsTeam` import with calls to `run_lead` from `backend.orchestrator.lead` and adapt the async interface. Neither file is wired to the new backend by default.

---

## How it works

1. **Ingest** — uploaded document is loaded, chunked, and indexed in SQLite with FTS5. Definition patterns and internal cross-references are extracted automatically.

2. **Lead Orchestrator** — receives the user's question and a chunk index. Uses tools (`search_document`, `resolve_reference`, `lookup_definition`, `read_document_chunk`) to navigate the document. Spawns specialised subagents for focused subtasks.

3. **SubAgents** — each runs a fresh Messages API call with an isolated context window containing only the chunks it needs. Prompt caching (1 h TTL) keeps repeated calls cheap. Every output must carry `[chunk_id]` citations.

4. **Parallelism** — independent subagents run via `asyncio.gather`. The Lead waits, validates citations, then synthesises.

5. **Streaming** — text deltas, tool calls, agent spawns, and artifact writes are pushed to the frontend via SSE in real time.

6. **Compaction** — when the Lead's context reaches 85% of 200K tokens, earlier turns are condensed into a structured summary so the session continues without interruption.

---

## Troubleshooting

### `ANTHROPIC_API_KEY` not set

```text
Error: ANTHROPIC_API_KEY environment variable not set
```

The CLI exits immediately with this message. For the backend, the error surfaces when the first agent call is made. Fix: set the variable and restart your terminal (Windows: use `setx`, then open a new terminal).

### Import errors when starting the backend

```text
ModuleNotFoundError: No module named 'backend'
```

You are running `uvicorn` from inside the `backend/` directory. Always run from the **repo root**:

```bash
# Wrong
cd backend && uvicorn app:app --reload

# Correct
uvicorn backend.app:app --reload --port 8000
```

### Frontend shows "Failed to fetch" or proxy errors

The Next.js frontend proxies API calls to `http://localhost:8000`. If the backend is not running, all API calls will fail with a network error. Start the backend first, then the frontend.

### PDF or DOCX files fail to load

If `PyPDF2` or `python-docx` are not installed, loading those file types raises an `ImportError`. Run:

```bash
pip install PyPDF2 python-docx
```

Plain text (`.txt`), Markdown (`.md`), and HTML (`.html`) files do not require either package.

### SQLite file-locking errors on Windows

SQLite uses WAL (Write-Ahead Logging) mode. On Windows, two processes opening the same `deep_reading.db` file simultaneously (e.g. the backend and the CLI) can occasionally collide. Run only one at a time, or point the CLI to a separate database by setting a different working directory.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Create a session |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/{id}` | Session detail (messages, documents, artifacts) |
| POST | `/api/sessions/{id}/documents` | Upload document (multipart) |
| POST | `/api/sessions/{id}/messages` | Submit question, starts agent run |
| GET | `/api/sessions/{id}/stream` | SSE stream of agent events |
| GET | `/api/sessions/{id}/context` | Token usage for context meter |
| POST | `/api/sessions/{id}/compact` | Manually trigger compaction |
| GET | `/api/artifacts/{id}` | Download artifact |
| GET | `/api/chunks/{id}` | Fetch source chunk (for citation drawer) |

---

## SSE event types

| Event | Fields | Description |
|-------|--------|-------------|
| `agent_spawned` | `agent_id`, `role`, `parent` | New agent started |
| `text_delta` | `agent_id`, `delta` | Streaming text chunk |
| `tool_use` | `agent_id`, `tool`, `input` | Agent called a tool |
| `artifact_written` | `artifact_id`, `name` | Artifact persisted |
| `agent_done` | `agent_id`, `summary` | Agent finished |
| `run_complete` | `final` | Full run finished |
| `context_usage` | `tokens`, `window`, `percent` | Context meter update |
| `compaction_done` | `before_tokens`, `after_tokens` | Compaction completed |

---

## Supported document formats

| Format | Extension | Requires |
| --- | --- | --- |
| PDF | `.pdf` | `PyPDF2` |
| Word | `.docx` | `python-docx` |
| Plain text | `.txt` | — |
| Markdown | `.md` | — |
| HTML | `.html`, `.htm` | — |

---

## Future phases (Phase B)

- **Document comparison** — diff two versions of an Act, section by section
- **Structured-data uploads** — DuckDB for xlsx/csv alongside text documents
- **Semantic search** — hybrid BM25 + vector search via `sqlite-vec` (no external vector DB)
- **Cross-session document library** — persistent workspaces per document
- **Cross-document RAG** — only when the user has 50+ documents and needs corpus search

See [PLAN.md](PLAN.md) for full roadmap and design rationale.
