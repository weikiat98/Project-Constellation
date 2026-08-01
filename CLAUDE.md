# CLAUDE.md: Constellation

## What this project is

Constellation is a full-stack multi-agent system for deep analysis of technical documents (legal Acts, regulations, academic papers, compliance frameworks). It is **not** a corpus search tool, it is optimised for depth on 1-5 known documents using Anthropic documentation.

Current version: **2.3.3**. Stack: Next.js 15 + React 19 (frontend), FastAPI + aiosqlite (backend), Anthropic SDK (agent orchestration).

---

## Repo layout

```
backend/
  app.py                  # FastAPI routes (all under /api)
  models.py               # Pydantic v2 schemas
  orchestrator/
    lead.py               # LeadOrchestrator agentic loop
    subagent.py           # SubAgent runner
    tools.py              # Tool schemas + dispatch
    event_bus.py          # Per-session SSE pub/sub + trace persistence
    compactor.py          # Context compaction (fires at 85% of 200K window)
    rate_limit.py         # Concurrency semaphore + exponential backoff
    errors.py             # Structured error classifier
  store/
    sessions.py           # SQLite schema, CRUD, FTS5
    documents.py          # Ingest pipeline wrapper
  extractors/
    definitions.py        # Defined-term regex extractor
    cross_refs.py         # Section cross-reference detector
frontend/
  app/
    page.tsx              # Splash
    home/page.tsx         # Home (draft upload + prompt)
    sessions/[id]/page.tsx  # Main chat view
  components/             # See component list below
  lib/
    api.ts                # Typed REST client
    sse.ts                # Typed EventSource wrapper
    citations.ts          # Citation regex (single source of truth)
document_loader.py        # Multi-format loader (PDF, DOCX, TXT, MD, HTML)
document_chunker.py       # Intelligent chunker (pages → chapters → sections)
cli.py                    # CLI: drives the same async orchestrator, no server needed
```

---

## Running the project

**Always run from the repo root**: the project is a Python package and `uvicorn` must find `backend/` on `sys.path`.

```bash
# Backend
uvicorn backend.app:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install   # first time only
npm run dev   # development
npm run build # verify no TS/build errors
npm run start # production
```

Required env var: `ANTHROPIC_API_KEY`.

---

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | : | Required |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Overrides Lead, SubAgent, and Compactor |
| `ADVISOR_MODEL` | *(empty)* | Set to `claude-opus-5` to enable the Advisor beta tool (max 3 uses/run) |
| `NEXT_PUBLIC_SSE_BASE` | `http://<host>:8000` | Override SSE base URL |
| `ANTHROPIC_MAX_CONCURRENCY` | `3` | Semaphore cap on simultaneous Anthropic streams |
| `ANTHROPIC_MAX_RETRIES` | `5` | Retry attempts for rate-limit / transient errors |

---

## Model roles

| Role | Default model | Override |
| --- | --- | --- |
| Lead Orchestrator | `claude-sonnet-5` (dev) / `claude-opus-5` (prod) | `ANTHROPIC_MODEL` or edit `lead.py` |
| SubAgents | `claude-haiku-4-5-20251001` | `ANTHROPIC_MODEL` |
| Compactor | `claude-haiku-4-5-20251001` | `ANTHROPIC_MODEL` |

Setting `ANTHROPIC_MODEL` overrides **all three**. For production, swap only the Lead by editing `lead.py` directly and leaving the others on Haiku.

---

## Key design constraints

**SQLite only.** Single-user, local-first. WAL mode handles concurrent async reads. FTS5 is built in. `Constellation.db` is the hard-coded filename: do not rename it without updating `DB_PATH` in `backend/store/sessions.py`.

**No vector database.** FTS5 BM25 is sufficient for within-document keyword recall. Vector search (Phase B) is only warranted for semantic search across 50+ documents.

**SSE bypasses Next.js proxy.** The `sse.ts` client connects directly to `http://localhost:8000`. Next.js would buffer the full stream and deliver it in one burst.

**`run_complete` ordering is load-bearing.** `add_message(...)` must be awaited before `bus.publish("run_complete", ...)` in all three finalisation branches. If this order is reversed, the frontend's `getSession()` call arrives before the assistant row is written.

**Citation enforcement is architectural.** Subagent results are checked for presence (at least one UUID-shaped `[chunk_id]` token) and validity (every cited UUID resolves in the DB). Results failing either check are returned to the Lead with flags; the Lead is instructed to re-spawn rather than synthesise. The subagent prompt also embeds the full list of valid chunk IDs for the task.

**`last_run_state` lives on the session row, not in memory.** States: `idle | running | completed | error | cancelled`. The frontend reads this on session mount to decide whether to re-attach SSE. Do not use in-process state for this.

**RAF-paced commit poll.** The frontend paces text reveal via `requestAnimationFrame`. On `run_complete`, a `commitPollId` interval waits for `pacingDone()` before calling `commit()`. Do not bypass this: committing early cuts off the visible typewriter effect.

---

## SQLite schema (summary)

```sql
sessions       (id, title, created_at, pinned, audience, last_run_state)
messages       (id, session_id, role, content, token_usage, thinking,
                artifact_ids_json, attached_document_ids_json, created_at)
documents      (id, session_id, filename, original_filename, chunk_count)
chunks         (id, document_id, idx, content, metadata, section_id, page)
chunks_fts     FTS5 virtual table: kept in sync with chunks via triggers
definitions    (id, document_id, term, definition, source_chunk_id)
cross_refs     (id, document_id, from_chunk_id, to_section_id)
artifacts      (id, session_id, name, content, mime_type, citations_json)
agent_runs     (id, session_id, parent_agent_id, role, status, tokens_in, tokens_out)
trace_events   (id, session_id, run_index, seq, event_type, payload, created_at)
```

Schema migrations are inline in `_init_db` (backend/store/sessions.py), each gated on a `PRAGMA table_info` check so re-runs are no-ops.

---

## SSE event types

| Event | Key fields | Notes |
| --- | --- | --- |
| `agent_spawned` | `agent_id`, `role`, `parent` | Persisted to trace |
| `thinking_delta` | `agent_id`, `delta` | Collapsible Thinking panel |
| `thinking_clear` | `agent_id` | UI-only; does NOT clear server-side buffer |
| `text_delta` | `agent_id`, `delta` | Finalize.result streamed in ~24-char slices |
| `final_message` | `content` | Authoritative final answer |
| `tool_use` | `agent_id`, `tool`, `input` | Persisted to trace |
| `artifact_written` | `artifact_id`, `name` | Persisted to trace |
| `agent_done` | `agent_id`, `summary` | Up to 2000 chars; persisted to trace |
| `context_usage` | `tokens`, `window`, `percent` | Context meter update |
| `compaction_done` | `before_tokens`, `after_tokens` | Persisted to trace |
| `run_complete` | `final` | Triggers commit poll + stream close |
| `error` | `message`, `technical`, `code`, `status` | Triggers stream close |

Persisted types (survive reload): `agent_spawned`, `tool_use`, `artifact_written`, `agent_done`, `compaction_done`.

---

## Lead tool catalogue

| Tool | Purpose |
| --- | --- |
| `read_document_chunk` | Fetch full chunk text by UUID |
| `search_document` | FTS5 BM25 search scoped to one document |
| `resolve_reference` | Section cross-reference → chunk |
| `lookup_definition` | Defined-term lookup from extracted glossary |
| `spawn_subagent` | Dynamic parallel subagent spawn |
| `write_artifact` | Persist named artifact (`text/plain`, `text/markdown`, `text/html`, `text/csv`) |
| `finalize` | End run, return user-facing answer |

All schemas are in `backend/orchestrator/tools.py`.

---

## Key frontend components

| Component | File | Responsibility |
| --- | --- | --- |
| `ChatPane` | `frontend/components/ChatPane.tsx` | Streaming messages, citation parsing, artifact cards, composer, token counter |
| `AgentTrace` | `frontend/components/AgentTrace.tsx` | Live/replayed event tree |
| `CitationLink` | `frontend/components/CitationLink.tsx` | `[chunk_id]` badge: SourceDrawer; retries once after 2 s if chunk not yet committed |
| `SourceDrawer` | `frontend/components/SourceDrawer.tsx` | Slide-in raw chunk viewer (`GET /api/chunks/{id}`) |
| `ArtifactPreview` | `frontend/components/ArtifactPreview.tsx` | Flex-row sibling canvas for MD/HTML/CSV/plain-text artifacts |
| `ContextMeter` | `frontend/components/ContextMeter.tsx` | Receives `totalTokens`/`window` props from ChatPane: does not fetch independently |
| `TokenCounter` | `frontend/components/TokenCounter.tsx` | Pre-send estimate; base count cached per session, deltas computed locally |
| `AudienceToggle` | `frontend/components/AudienceToggle.tsx` | Layperson / Professional / Expert |

---

## Extending the system

**Add a Lead tool:** append schema to `LEAD_TOOLS` in `tools.py` → add handler branch in `handle_tool` → publish an SSE event if user-visible → update the Lead system prompt.

**Add an SSE event:** `bus.publish("my_event", ...)` → optionally add to `_PERSIST_TYPES` in `event_bus.py` and extend `persistedToTrace` in `sessions/[id]/page.tsx` → add union member to `SSEEvent` in `sse.ts` → handle in `attachStream`.

**Add a document format:** extend `DocumentLoader.load_document` in `document_loader.py` → surface structural metadata in `DocumentChunker.smart_chunk` → add extension to file-input `accept` attributes on the home and upload UIs.

---

## Security notes

- **FTS5 injection**: neutralised by `_fts5_safe`: every LLM-generated query is tokenised and quoted before reaching the FTS5 parser.
- **File path safety**: uploads always go through `NamedTemporaryFile`; the original filename is carried as a separate argument and never used for disk I/O.
- **CORS**: locked to `localhost:3000` and `127.0.0.1:3000`. Widen deliberately before any deployment.
- **API key**: read from env; never logged, never sent to the frontend, never written to disk.
- **Prompt injection**: documents may contain adversarial text. The Lead system prompt pins citation requirements; subagents are restricted to `read_document_chunk` only, so a successful injection can at most produce incorrect prose: it cannot exfiltrate data, execute code, or reach external services.

---

## Documentation notes

- Never use em-dashes when writing documentations and ALWAYS use ": " instead, even for titles and headings.
- When working on a task, if there are side-findings discovered, document these side-findings in a markdown file known as OBSERVATIONS.md to track these findings to glance at later and decide what to do with, solving the bug-next-door problem.
- When a task is completed, do a reflection and record reflections in a markdown file known as REFLECTIONS.md. Examples can be what are the surprise findings, what broke, what it’d do differently.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md): component-level architecture with system diagram and design decisions
- [README.md](README.md): User Guide Manual.
- [technical_docs.md](technical_docs.md): full API reference, SSE protocol, schema, orchestration internals, extension points
- [CHANGELOG.md](CHANGELOG.md): version history (Keep a Changelog format)
- [TODO.md](TO-DO.md): Tasks items to do.
