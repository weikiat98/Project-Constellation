# Constellation

A full-stack multi-agent system for deep analysis of lengthy and technical documents — legal regulations, academic papers, compliance frameworks, and policy documents — powered by the Anthropic API.

Every claim in every answer carries a citation. Every citation is clickable. Every source is verifiable.

> **Version 2.3.3** — Conversation continuity, token-meter accuracy, and streaming robustness. See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## Table of contents

- [What it does](#what-it-does)
- [What's new in 2.3.3](#whats-new-in-233)
- [What's new in 2.3](#whats-new-in-23)
- [What's new in 2.2](#whats-new-in-22)
- [What's new in 2.1](#whats-new-in-21)
- [Simplified architecture](#simplified-architecture)
- [Models and cost architecture](#models-and-cost-architecture)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Environment variables](#environment-variables)
- [Setup](#setup)
- [Using the app](#using-the-app)
- [CLI usage](#cli-usage)
- [Troubleshooting](#troubleshooting)
- [Supported document formats](#supported-document-formats)
- [Further reading](#further-reading)

---

## What it does

Upload a PDF, DOCX, or text document and ask questions in natural language. A **Lead Orchestrator** plans the work, then spawns specialised **subagents** in parallel — each handed only the chunks it needs for its focused subtask. Results are synthesised and returned with inline citations that open the exact source passage.

Four product goals shape every feature:

1. **Understandable** — plain-language rewrites at three expertise levels (layperson / professional / expert).
2. **Navigable** — FTS5 keyword search, cross-reference resolution, and defined-term lookup inside the document.
3. **Verifiable** — every factual claim links back to its source chunk. Subagent output missing citations is flagged and rejected.
4. **Actionable** — structured deliverables (obligation tables, comparisons, summaries) are persisted as downloadable artifacts (Markdown, HTML, CSV).

---

## What's new in 2.3.3

Conversation continuity, token-meter accuracy, and streaming robustness fixes.

- **Conversation memory across turns** — the Lead now receives the full prior chat history on every run. Follow-up prompts like "convert that to CSV" or "extend point 3" work correctly instead of producing hallucinated chunk IDs or claiming no artifact exists.
- **Artifact catalogue in Lead context** — existing session artifacts are listed in the initial user content (with a 400-char preview each) so the Lead can reference, convert, or extend them without rediscovering the document from scratch.
- **Context meter accuracy** — `GET /api/sessions/{id}/context` now builds the rendered system prompt, doc-index string, and tool definitions for the correct audience, matching what a real run sends. The meter no longer jumps at the start of each turn.
- **Token counter no longer spams the API** — the base token count (history + docs + tools) is fetched once per session and cached. Keystrokes derive the draft-prompt delta locally; the cache is only busted on document changes or run completion.
- **`run_complete` published after `add_message`** — fixes a race where the frontend's `getSession()` call (triggered by `run_complete`) could arrive before the new assistant row was written, leaving the chat bubble in a partial-text hang.
- **Three-step artifact reveal** — artifacts now reveal in sequence: recap text streams → "Generated files" button appears → canvas opens (600 ms later). Eliminates the layout shift that made long answers appear to stop mid-sentence.
- **Citation label retry** — `CitationLink` now retries a failed chunk lookup once after 2 seconds, catching chunks that weren't committed yet when citations first rendered mid-stream. Null results are no longer cached permanently.
- **SSE close/commit race fixed** — `cancelPendingFlushes()` is skipped when a `run_complete` commit is already in progress, preventing long responses from being stranded in a partial-text state.

---

## What's new in 2.3

Robustness and capability improvements on top of the 2.2 UAT fix release.

- **Adaptive thinking** — the Lead now passes `{"type": "adaptive"}` to `claude-sonnet-4-6` and `claude-opus-4-7`, letting the model decide when and how much to reason. Interleaved thinking is automatically active so the Lead can reflect between tool calls.
- **Server-side streaming of the final answer** — the Lead chunks the final answer into 20-character segments emitted as `text_delta` events (15 ms apart) so the chat pane renders incrementally without a client-side typewriter fighting the SSE stream.
- **Default model is now `claude-sonnet-4-6`** — Haiku was unreliable at audience register differentiation. Sonnet is the new development default; switch to `claude-opus-4-6` for production.
- **Run cancellation** — `POST /api/sessions/{id}/cancel` stops the in-flight Lead run at its next iteration. The session transitions to `last_run_state = "cancelled"` and the SSE stream closes cleanly.
- **Multi-file upload** — the upload zone now accepts multiple files in a single drag-drop or file-picker action. Each file is ingested sequentially and the session document list updates after each one.
- **Idle SSE guard** — opening `/stream` on a session with no active run now returns a synthetic `run_complete` immediately instead of hanging the connection indefinitely.
- **Citation links in plain-text artifacts** — `[chunk_id]` tokens in plain-text artifacts are now rendered as clickable citation links, consistent with Markdown and HTML artifacts.
- **Token counter uses attached doc IDs** — `count_tokens` now filters the doc-index to only the documents attached to the current message, matching what the Lead actually sends to the model.
- **Document chunker page numbers fixed** — page numbers in chunk metadata now reflect the actual page markers in the document instead of an incrementing counter.
- **FTS5 safety extended** — legal-style queries containing dots, hyphens, slashes, and section signs (`§`) are preserved through tokenisation instead of being stripped to single letters.
- **`PRAGMA foreign_keys=ON` applied per-connection** — foreign-key enforcement is now correctly set on every SQLite connection; previously it was silently disabled on all connections after the first, breaking cascade deletes.

---

## What's new in 2.2

UAT-driven fix release. Closes every issue logged in the 25 April UAT pass plus the free-form observations.

- **Audience toggle now actually changes the output** — the layperson / professional / expert prompts were rewritten as multi-paragraph briefs (reader profile, forbidden vocabulary, required vocabulary, worked example) and hoisted to the top of the system prompt. A new finalize-time self-check rewrites any sentence that violates the chosen register.
- **Typewriter reveal works end-to-end** — the final-message recap now visibly types out with a blinking cursor and disappears cleanly when done. Internally, `run_complete` no longer unmounts the streaming bubble before the animation runs; the commit is deferred until the typewriter finishes.
- **Cumulative context meter** — the meter now grows monotonically across turns and only dips on compaction, instead of resetting to single-digit % on each new turn.
- **Multi-session run management** — switching to another session mid-run no longer abandons the run. A new `last_run_state` field on the session record lets the UI re-attach the SSE stream when you return.
- **Document chips persist across reloads** — each user message records the documents that were attached at send time, so the chips re-render correctly after a page refresh.
- **Past-turn thinking panel** — the collapsible "Thought process" panel on previous assistant messages is restored. Server-side thinking buffer is no longer wiped by `thinking_clear`.
- **Audience-mode banner** — switching modes (manually or via prompt inference) drops a centred `~ switched to layperson mode ~` marker in the chat.
- **Delete uploaded documents** — Trash icon in the Session files popover removes a document from the session. Refused with a 409 if the document is referenced by a persisted message.
- **Polish** — copy button in artifact preview, self-sizing artifact cards (hug the title up to ~24 rem), `agent_done` summaries no longer clipped at 200 chars / 3 lines.

Detailed root-cause analysis and per-issue verification: [UAT/25April_UAT_Resolution_Plan.md](UAT/25April_UAT_Resolution_Plan.md).

---

## What's new in 2.1

- **Splash → Home → Session flow** — a three-page app: landing splash, a home screen with greeting + draft upload, and per-session chat pages.
- **Persistent chat sidebar** — list, pin, rename, and delete sessions; titles auto-generated from the first user message.
- **Edit / retry** — edit a prior user message or retry any assistant reply; the backend truncates history cleanly before re-running.
- **Thinking panel** — the Lead's and subagents' reasoning stream as a collapsible "Thinking…" block, separate from the final answer.
- **Artifact preview canvas** — artifacts render inline in a slide-in pane with Markdown/HTML/CSV support, not as a raw download.
- **Persistent agent trace** — tool calls, agent spawns, and compaction events survive page reloads and session switches.
- **Draft sessions** — drop files on the home screen before composing a prompt; a draft session is created lazily.
- **Drag-and-drop everywhere** — both the home screen and session pages accept dropped files.
- **Stable `final_message` contract** — the user-facing answer ships as a single SSE event, cleanly separated from streaming reasoning.
- **Full async backend** — the original synchronous `LibrarianAgentsTeam` prototype has been removed; the CLI now drives the same async orchestrator as the web app.
- **Splash Page Cosmetics** — Added transitional backgrounds and updated colour scheme.
- **Pre-send token counter** — the composer now shows a live token estimate for the draft prompt and the base context (system prompt, tools, document index, chat history) via a new `POST /api/sessions/{id}/count_tokens` endpoint backed by Anthropic's free `count_tokens` call.
- **Persistent per-session audience** — the selected audience (layperson / professional / expert) is stored on the session row and restored on reload instead of resetting each turn.
- **Optional Advisor tool** — set `ADVISOR_MODEL=claude-opus-4-7` to let the Lead consult a more capable model up to 3 times per run (planning, post-synthesis, pre-finalize). Advisor output is surfaced into the Thinking panel. Leave unset to disable.
- **`thinking_clear` SSE event** — when the Lead ends a turn with plain text instead of `finalize`, the frontend clears the Thinking panel so the same text isn't shown twice.

---

## Simplified architecture

```text
┌────────────────────────────────────────────────────────────┐
│  Frontend  (Next.js 15 + React 19 + Tailwind + shadcn/ui)  │
│  - Splash → Home → Session                                 │
│  - Sidebar | Chat + Thinking | Trace | Artifact canvas     │
│  - SSE consumer, streaming renderer, citation drawer       │
│  - Audience toggle, context meter, drag-and-drop upload    │
└──────────────────────────────▲─────────────────────────────┘
                               │  HTTPS + SSE (direct to :8000)
┌──────────────────────────────▼─────────────────────────────┐
│  Backend  (FastAPI + async uvicorn, v1.2.0)                │
│  - REST: /sessions, /documents, /messages, /artifacts      │
│  - SSE: /sessions/{id}/stream                              │
│  - Persisted trace: /sessions/{id}/trace                   │
│  - SQLite (sessions, chunks, FTS5, definitions, artifacts, │
│    agent_runs, trace_events)                               │
└──────────────────────────────▲─────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────┐
│  Agent Orchestration  (anthropic SDK, async)               │
│  - LeadOrchestrator: tool-use loop + compaction + finalize │
│  - SubAgents: spawned dynamically, parallel via gather     │
│  - Prompt caching on document chunks (1 h TTL)             │
│  - Citation enforcement: rejects uncited subagent output   │
└────────────────────────────────────────────────────────────┘
```

Full technical reference: [technical_docs.md](technical_docs.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Models and cost architecture

The system uses two Claude models deliberately for a cost/quality tradeoff:

| Role | Default model | Rationale |
| --- | --- | --- |
| Lead Orchestrator (`lead.py`) | `claude-sonnet-4-6` *(dev default)* / `claude-opus-4-6` *(production)* | Reasoning, tool-use orchestration, synthesis. Sonnet is the development default as of 2.3; swap to Opus for production-grade answers. |
| SubAgents (`subagent.py`) | `claude-haiku-4-5-20251001` | Fast and cheap; each subagent does a narrow, citation-bounded task. |
| Compactor (`compactor.py`) | `claude-haiku-4-5-20251001` | Context summarisation — no complex reasoning needed. |

All three roles read from the `ANTHROPIC_MODEL` environment variable. Setting it overrides **all three** to the same model — useful for strict cost control or smoke tests, but will reduce Lead quality if set to Haiku in production.

---

## Project structure

```text
constellation/
│
├── backend/                          # FastAPI application (v1.2.0)
│   ├── app.py                        # Routes: sessions, documents, messages, SSE, trace, artifacts
│   ├── models.py                     # Pydantic v2 schemas
│   ├── orchestrator/
│   │   ├── lead.py                   # LeadOrchestrator agentic loop
│   │   ├── subagent.py               # SubAgent runner (parallel via asyncio.gather)
│   │   ├── tools.py                  # Lead tool schemas + handlers
│   │   ├── event_bus.py              # Per-session SSE pub/sub + trace persistence
│   │   └── compactor.py              # 85%-threshold Lead-context compaction
│   ├── store/
│   │   ├── sessions.py               # SQLite: sessions, messages, chunks, FTS5, artifacts, trace_events
│   │   └── documents.py              # DocumentStore (ingest → chunk → FTS index)
│   └── extractors/
│       ├── definitions.py            # Defined-term extractor
│       └── cross_refs.py             # Section cross-reference detector
│
├── frontend/                         # Next.js 15 application (v2.2.0)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Splash page
│   │   ├── home/page.tsx             # Home: greeting + draft upload + prompt bar
│   │   └── sessions/[id]/page.tsx    # Chat view with trace, artifact canvas, source drawer
│   ├── components/
│   │   ├── ChatSidebar.tsx           # Pin/rename/delete sessions
│   │   ├── ChatPane.tsx              # Streaming chat + thinking + retry/edit
│   │   ├── AgentTrace.tsx            # Live agent event tree (collapsible)
│   │   ├── AgentTracePanel.tsx       # Dock panel for trace
│   │   ├── UploadZone.tsx            # Drag-and-drop upload
│   │   ├── ArtifactCard.tsx          # Inline artifact row
│   │   ├── ArtifactPreview.tsx       # Slide-in artifact canvas (MD/HTML/CSV)
│   │   ├── CitationLink.tsx          # Clickable [chunk_id]
│   │   ├── SourceDrawer.tsx          # Slide-in passage viewer
│   │   ├── AudienceToggle.tsx        # Layperson / Professional / Expert
│   │   ├── ContextMeter.tsx          # Token-usage bar + Compact button
│   │   ├── TokenCounter.tsx          # Pre-send prompt + base-context token estimate
│   │   └── SessionFiles.tsx          # Per-session files menu
│   └── lib/
│       ├── api.ts                    # Typed fetch helpers
│       ├── sse.ts                    # Typed EventSource wrapper
│       └── citations.ts              # Citation parsing/rendering helpers
│
├── document_loader.py                # Multi-format loader (PDF, DOCX, TXT, MD, HTML)
├── document_chunker.py               # Intelligent chunker (pages, chapters, sections)
├── cli.py                            # CLI driving the same async orchestrator (no server required)
├── requirements.txt                  # Python dependencies
├── README.md                         # This file
├── technical_docs.md                 # Comprehensive technical documentation
├── CHANGELOG.md                      # Version history
├── ARCHITECTURE.md                   # Deep architecture notes
└── PLAN.md                           # Roadmap and design rationale
```

---

## Requirements

- **Backend** — Python 3.11+, an `ANTHROPIC_API_KEY`.
- **Frontend** — Node.js 20+.

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key. Get one at [console.anthropic.com](https://console.anthropic.com). |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Overrides the model used by Lead, SubAgent, and Compactor. For production Lead quality, set to `claude-opus-4-6` (or leave the value in `lead.py` and keep Haiku for the other two). |
| `NEXT_PUBLIC_SSE_BASE` | No | `http://<host>:8000` | Base URL the browser uses to connect to the SSE stream. Useful when the backend runs on a non-default host/port. |
| `ADVISOR_MODEL` | No | *(empty — disabled)* | Enables the Advisor tool on the Lead executor. Set to `claude-opus-4-7` to let the Lead consult a stronger model up to 3 times per run. Leave unset for strict cost control. |

Example — run everything on Haiku to minimise cost (lower Lead quality):

```bash
export ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Example — upgrade the Lead to Opus for production quality:

```bash
export ANTHROPIC_MODEL=claude-opus-4-6
```

---

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

`PyPDF2` and `python-docx` are installed by default. TXT / Markdown / HTML work without them.

### 2. Set the API key

On Linux / macOS:

```bash
export ANTHROPIC_API_KEY='your-key-here'
```

On Windows:

```bat
setx ANTHROPIC_API_KEY "your-key-here"
```

Then restart your terminal.

### 3. Start the backend

> **Run from the repo root**, not from inside `backend/`. The project is structured as a Python package (`backend/__init__.py`); running `uvicorn` from the repo root puts the root on `sys.path` so `from backend.orchestrator.lead import ...` resolves. Running it from `backend/` causes `ModuleNotFoundError: No module named 'backend'`.

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

> The terminal prints `constellation@2.3.3 dev` — that's the package name and version from [frontend/package.json](frontend/package.json), not a warning.

### 5. Stop the servers

Press `Ctrl+C` in each terminal.

---

## Using the app

A complete session, from splash to cited answer:

### Step 1 — Splash → Home

The splash page (`/`) shows the **Constellation** title and a **START** button over a crossfading backdrop slideshow (6-second interval, 2-second fade) with a dark gradient overlay for legibility. Swap or extend the imagery by dropping new `.jpg` / `.webp` files into [frontend/public/splash/](frontend/public/splash/) and adding their paths to the `SLIDES` array in [frontend/app/page.tsx](frontend/app/page.tsx). Clicking START takes you to `/home`, the greeting page with the main prompt bar.

### Step 2 — Upload a document (optional, on the home page)

Drag a PDF / DOCX / TXT / MD / HTML onto the home screen, or click the **+** button and choose "Upload files". A **draft session** is created on first upload so the file has somewhere to live. You can attach multiple documents before sending.

Behind the scenes the upload triggers:

- File load + intelligent chunking (~4000 tokens/chunk).
- Chunks stored in SQLite with an FTS5 full-text index.
- Definition and cross-reference extraction run as background tasks.

### Step 3 — Ask a question

Type your question and hit Enter (or click the send button). The app navigates to `/sessions/<id>` and starts streaming. The session title is auto-generated from the first line of your prompt.

**What you see:**

- **Chat pane** — streaming final answer with inline `[chunk_id]` citations.
- **Thinking panel** — collapsible; shows Lead and subagent reasoning as it happens.
- **Agent Trace** — live tree of agent spawns, tool calls, artifact writes, and compaction events.
- **Context Meter** — token usage bar. A Compact button lets you trigger manual compaction.
- **Artifact Preview** — when the Lead calls `write_artifact`, the result slides in as a canvas beside the chat.

**What happens inside:**

1. The Lead receives your question plus a 50-chunk index of the document.
2. It uses `search_document` / `read_document_chunk` to explore structure.
3. It spawns 2–5 subagents in parallel via `spawn_subagent` — each gets only the chunk IDs it needs.
4. Subagents run concurrently (`asyncio.gather`). Every result is validated on two axes: presence (at least one `[chunk_id]` token exists) and validity (every cited UUID resolves to a real chunk in the database). Results that fail either check are flagged and the Lead is instructed to re-spawn rather than synthesize from them.
5. The Lead synthesises, optionally calls `write_artifact`, and ends with `finalize`.

### Step 4 — Verify claims

Click any inline `[chunk_id]` citation — a **Source Drawer** slides in with the exact passage, section, and page. Click an artifact row to open it in the preview canvas.

### Step 5 — Iterate

- **Retry** an assistant reply — truncates history at that point and re-runs.
- **Edit** a user message — truncates, rewrites, re-runs.
- **Cancel** a running answer — `POST /api/sessions/{id}/cancel` stops the in-flight run at its next iteration; the SSE stream closes cleanly and `last_run_state` transitions to `cancelled`.
- **Rename** the session via the pencil icon in the header.
- **Pin** sessions from the sidebar.
- **Delete documents** — trash icon in the Session files popover removes an uploaded document (refused with 409 if the document is referenced by a persisted message).
- **Compact** long sessions manually, or let it fire automatically at 85% of the 200K window.

---

## CLI usage

The CLI drives the **same async orchestrator** as the web app — no FastAPI server required, same SQLite store.

```bash
# Single question
python cli.py -i regulation.pdf -r "What obligations does this impose on small businesses?"

# Save answer to a file
python cli.py -i policy.pdf -r "Summarise Part 3" -o summary.md

# Interactive Q&A with an audience level
python cli.py -i act.pdf --interactive --audience layperson

# Verbose: show the agent event trace
python cli.py -i paper.pdf -r "What are the main findings?" --verbose
```

Audience options: `layperson` | `professional` (default) | `expert`.

---

## Troubleshooting

### `ANTHROPIC_API_KEY` not set

The CLI exits immediately. For the backend, the error surfaces on the first agent call. Set the variable, restart your terminal (Windows: `setx`, then open a new terminal).

### `ModuleNotFoundError: No module named 'backend'`

You ran `uvicorn` from inside `backend/`. Always run from the **repo root**:

```bash
# Wrong
cd backend && uvicorn app:app --reload

# Correct
uvicorn backend.app:app --reload --port 8000
```

### Frontend shows "Failed to fetch"

Next.js proxies REST calls to `http://localhost:8000`, and the SSE stream connects directly to port 8000. Start the backend first, then the frontend.

### SSE stream delivers everything at once, at the end

You are hitting the Next.js proxy. The SSE client in [frontend/lib/sse.ts](frontend/lib/sse.ts) bypasses the proxy and connects to port 8000 directly. If you've changed the backend host or port, set `NEXT_PUBLIC_SSE_BASE`.

### PDF or DOCX files fail to load

Install the optional parsers:

```bash
pip install PyPDF2 python-docx
```

TXT / Markdown / HTML work without them.

### SQLite file-locking on Windows

SQLite uses WAL mode. On Windows, two processes opening the same `deep_reading.db` simultaneously (e.g. backend + CLI) can occasionally collide. Run one at a time, or point the CLI at a separate working directory.

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

## Further reading

- [technical_docs.md](technical_docs.md) — comprehensive technical documentation (API reference, SSE events, schema, orchestration internals).
- [ARCHITECTURE.md](ARCHITECTURE.md) — component-level architecture notes.
- [CHANGELOG.md](CHANGELOG.md) — version history.
- [PLAN.md](PLAN.md) — roadmap and design rationale for Phase B (document diff, semantic search, cross-document RAG).
