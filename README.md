# Deep-Reading Assistant

A full-stack multi-agent system for deep analysis of lengthy, high-stakes documents — legal Acts, regulations, academic papers, and compliance frameworks.

Every agent output cites its source. Every claim is verifiable.

---

## What it does

Upload a PDF, DOCX, or text document and ask questions in natural language. A Lead Orchestrator spawns specialised subagents in parallel, each working on a focused subtask with access only to the chunks it needs. Results are synthesised and returned with inline citations you can click to verify against the original text.

**Understandable** — plain-language rewrites at adjustable expertise levels (layperson / professional / expert).

**Navigable** — cross-reference resolution, glossary lookup, FTS5 keyword search within the document.

**Verifiable** — every factual claim links back to its source chunk. Subagent output without citations is flagged and rejected.

**Actionable** — extract obligations, findings, and comparisons into downloadable artifacts (Markdown, HTML, CSV).

---

## Architecture

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

## Project structure

```text
deep-reading-assistant/
│
├── backend/                        # FastAPI application
│   ├── app.py                      # Routes: sessions, documents, messages, SSE, artifacts
│   ├── models.py                   # Pydantic v2 schemas
│   ├── orchestrator/
│   │   ├── lead.py                 # LeadOrchestrator agentic loop
│   │   ├── subagent.py             # SubAgent runner (parallel, citation-enforced)
│   │   ├── tools.py                # Tool definitions + handlers
│   │   ├── event_bus.py            # Per-session SSE pub/sub
│   │   └── compactor.py            # Lead-context compaction (auto at 85%)
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
├── cli.py                          # CLI — repointed to new async orchestrator
├── requirements.txt                # Python dependencies
│
├── librarian_agents_team.py        # Original synchronous prototype (kept for reference)
├── advanced_examples.py            # Example scenarios (can be used as integration tests)
└── test_example.py                 # Test workflow (can be repurposed for backend tests)
```

---

## Requirements

### Backend

- Python 3.11+
- `ANTHROPIC_API_KEY` environment variable

### Frontend

- Node.js 20+

---

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Set API key

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

---

## CLI usage

The CLI connects to the same async orchestrator engine without the web UI:

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

## How it works

1. **Ingest** — uploaded document is loaded, chunked, and indexed in SQLite with FTS5. Definition patterns and internal cross-references are extracted automatically.

2. **Lead Orchestrator** — receives the user's question and a chunk index. Uses tools (`search_document`, `resolve_reference`, `lookup_definition`, `read_document_chunk`) to navigate the document. Spawns specialised subagents for focused subtasks.

3. **SubAgents** — each runs a fresh Messages API call with an isolated context window containing only the chunks it needs. Prompt caching (1 h TTL) keeps repeated calls cheap. Every output must carry `[chunk_id]` citations.

4. **Parallelism** — independent subagents run via `asyncio.gather`. The Lead waits, validates citations, then synthesises.

5. **Streaming** — text deltas, tool calls, agent spawns, and artifact writes are pushed to the frontend via SSE in real time.

6. **Compaction** — when the Lead's context reaches 85% of 200K tokens, earlier turns are condensed into a structured summary so the session continues without interruption.

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

| Format | Extension |
|--------|-----------|
| PDF | `.pdf` |
| Word | `.docx` |
| Plain text | `.txt` |
| Markdown | `.md` |
| HTML | `.html`, `.htm` |

---

## Future phases (Phase B — build on demand)

- **Document comparison** — diff two versions of an Act, section by section
- **Structured-data uploads** — DuckDB for xlsx/csv alongside text documents
- **Semantic search** — hybrid BM25 + vector search via `sqlite-vec` (no external vector DB)
- **Cross-session document library** — persistent workspaces per document
- **Cross-document RAG** — only when the user has 50+ documents and needs corpus search

See [PLAN.md](PLAN.md) for full roadmap and design rationale.
