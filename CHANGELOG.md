# Changelog

All notable changes to Constellation are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-2.0 entries are reconstructed retroactively from git history and therefore list the significant changes per era rather than a per-commit log.

---

## [2.1.0] — 2026-04-22: Frontend Edits, Token Counter, Advisor Tool

### Added

- **Splash slideshow** — the landing page ([frontend/app/page.tsx](frontend/app/page.tsx)) now crossfades through six full-screen backdrop images (`constellation`, `galaxy`, `starrynight` pairs) on a 6-second interval with a 2-second opacity transition. Images are preloaded on mount so the first crossfade never flashes. A top-to-bottom black gradient overlay (`from-black/70 via-black/50 to-black/80`) keeps the title, tagline, and START button legible over bright backdrops. Drop-in location for new images: [frontend/public/splash/](frontend/public/splash/).
- **Pre-send token counter** — new [TokenCounter](frontend/components/TokenCounter.tsx) component surfaces a live token estimate next to the composer. Shows the draft prompt cost and the base context size (system prompt + tools + 50-chunk document index + chat history) so the user can tell how much of the 200K window a turn will consume before hitting send.
- **`POST /api/sessions/{id}/count_tokens` endpoint** — wraps Anthropic's free `count_tokens` call in [backend/app.py](backend/app.py) and returns `{ prompt_tokens, base_tokens, total_tokens, window, percent }`. Falls back to the in-house `len(str) // 4` approximation if the Anthropic call fails so the UI never breaks.
- **`TokenCountRequest` / `TokenCountOut` Pydantic schemas** in [backend/models.py](backend/models.py).
- **Advisor tool (opt-in)** — set `ADVISOR_MODEL=claude-opus-4-7` to attach Anthropic's beta `advisor_20260301` tool to the Lead executor. The Lead can consult the advisor up to 3 times per run (planning, post-synthesis, pre-finalize). Advisor output arrives as `advisor_tool_result` blocks in the response and is surfaced to the UI as `thinking_delta` events prefixed with `[Advisor]`. Advisor token usage is accumulated into the Lead's tokens_in/tokens_out for accurate accounting. See [backend/orchestrator/lead.py](backend/orchestrator/lead.py).
- **`thinking_clear` SSE event** — emitted by the Lead when `stop_reason == "end_turn"` so the model's plain-text response isn't shown twice (once in Thinking, once as the final message). Wired through [backend/orchestrator/event_bus.py:70](backend/orchestrator/event_bus.py#L70) (clears the thinking buffer) and handled in the frontend SSE client.
- **Persistent per-session audience** — new `sessions.audience` column and `SessionUpdate.audience` field. The audience toggle now writes through to `PATCH /api/sessions/{id}` on change, so reloading a session restores the user's last choice instead of defaulting to "professional".
- **Expanded `finalize`-miss recovery ladder** — when the Lead loop exits without calling `finalize` (iteration cap hit, model ended with `tool_use`, etc.), [lead.py:389](backend/orchestrator/lead.py#L389) now walks three tiers: scrape trailing text blocks → backfill a recap pointing at any artifacts produced this turn → honest "couldn't produce an answer, try Retry" message. Prevents silent empty assistant bubbles.

### Changed

- **Project renamed to Constellation** — the product name "Deep-Reading Assistant" has been retired in favour of **Constellation** across all user-facing surfaces: the FastAPI app title, frontend `<title>`, CLI banner and `--help` description, sidebar header, session fallback title, Lead system prompt preamble, `frontend/package.json` / `package-lock.json` `name` field, README, PLAN, ARCHITECTURE, CHANGELOG, and technical_docs. The database filename (`deep_reading.db`) and the internal `DB_PATH` identifier were deliberately left untouched to avoid migration churn — they are not user-facing.
- **Splash layout** — the inline `BookOpen` icon next to the title has been removed on the splash page only; the home page sidebar and assistant avatar still use it.
- **Primary CTA palette shift** — the signature blue buttons on four high-visibility surfaces flipped to white with `text-slate-900` for a cleaner look against the darker chrome:
  - START button on the splash page ([frontend/app/page.tsx](frontend/app/page.tsx)).
  - **+ New chat** button in the sidebar ([frontend/components/ChatSidebar.tsx](frontend/components/ChatSidebar.tsx)).
  - Active state of the audience toggle — Layperson / Professional / Expert ([frontend/components/AudienceToggle.tsx](frontend/components/AudienceToggle.tsx)).
  - Send buttons on both the home prompt bar ([frontend/app/home/page.tsx](frontend/app/home/page.tsx)) and the session chat composer ([frontend/components/ChatPane.tsx](frontend/components/ChatPane.tsx)).
  Other blue accents (user-message bubble, assistant avatar dot, context meter, retry-in-edit button, drag-drop overlay) are intentionally unchanged.

---

## [2.0.0] — Full-stack multi-agent revamp

The first release under the new architecture. The original synchronous `LibrarianAgentsTeam` prototype has evolved with a FastAPI + Next.js application driven by an async orchestrator-workers agent loop.

### Added

- **Splash → Home → Session flow** — a three-page experience with a landing splash (`/`), a greeting/draft-upload home (`/home`), and per-session chat pages (`/sessions/[id]`).
- **Persistent chat sidebar** — list, pin, rename, and delete sessions. Auto-generated titles from the first user message.
- **Edit and retry** — edit a prior user message or retry any assistant reply; the backend truncates history from the pivot message onward via `DELETE /api/sessions/{id}/messages/after/{message_id}`.
- **Thinking panel** — Lead and subagent reasoning stream as `thinking_delta` events, rendered as a collapsible "Thinking…" block separate from the final answer.
- **Stable `final_message` contract** — the user-facing answer is delivered as a single SSE event, cleanly decoupled from the reasoning stream.
- **Artifact preview canvas** — artifacts slide in as a flex-row sibling of the chat (not an overlay) with Markdown, HTML, CSV, and plain-text rendering and a download button.
- **Persistent agent trace** — `agent_spawned`, `tool_use`, `artifact_written`, `agent_done`, and `compaction_done` events are persisted to a new `trace_events` table and replayed on session load so history survives reloads.
- **Draft sessions** — drop files on the home screen before composing a prompt; a session is created lazily on first upload.
- **Drag-and-drop everywhere** — both the home screen and session pages accept dropped files.
- **Session pinning** — `sessions.pinned` column + `PATCH /api/sessions/{id}` support pinning from the sidebar.
- **FastAPI backend** — async routes for sessions, documents, messages, SSE stream, context meter, compaction trigger, trace replay, artifact fetch, and chunk fetch.
- **SQLite schema** — `sessions`, `messages`, `documents`, `chunks`, `chunks_fts` (FTS5), `definitions`, `cross_refs`, `artifacts`, `agent_runs`, `trace_events`.
- **Async multi-agent orchestration** — `LeadOrchestrator` with `search_document`, `read_document_chunk`, `resolve_reference`, `lookup_definition`, `spawn_subagent`, `write_artifact`, and `finalize` tools. Subagents run in parallel via `asyncio.gather`.
- **Prompt caching** — ephemeral cache control on Lead and SubAgent system prompts (1 h TTL).
- **Citation enforcement** — subagent outputs are regex-scanned for UUID citations; uncited results are flagged and returned to the Lead with a warning note.
- **Automatic compaction** — at 85% of the 200K token window, the Haiku compactor summarises earlier turns into a structured memory so the session continues without interruption.
- **FTS5 query safety** — `_fts5_safe` tokenises and quotes LLM-generated queries so operators cannot reach the parser.
- **Definition and cross-reference extractors** — run as background tasks on upload to populate `definitions` and `cross_refs`.
- **Typed frontend API layer** — `api.ts` and `sse.ts` with full TypeScript types for every REST response and SSE event.
- **Direct-to-backend SSE** — the SSE client bypasses the Next.js proxy (which buffers streamed responses) and connects directly to port 8000. Override with `NEXT_PUBLIC_SSE_BASE`.
- **Source drawer with filename context** — `GET /api/chunks/{id}` returns the user-facing document filename so citations render meaningful labels instead of opaque hashes.
- **Finalize safety net** — if the Lead wrote an artifact but returned an empty `result`, a fallback recap pointing at the artifact name is auto-generated so the UI never shows a blank message.
- **Async CLI** — `cli.py` now drives the same `run_lead` entry point as the web app, with `--interactive`, `--audience`, `--verbose`, and `-o` flags.
- **technical_docs.md** — comprehensive developer reference covering the API, schema, orchestration, SSE protocol, and extension points.

### Changed

- **Version bump** — `frontend/package.json` `"version": "0.1.0"` → `"2.0.0"`, reflecting the scale of the rewrite. Backend FastAPI app version is `1.0.0`.
- **Models** — dev default is now `claude-haiku-4-5-20251001` across Lead, SubAgent, and Compactor for cost control during local work. For production, swap the Lead to `claude-opus-4-6` in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) or set `ANTHROPIC_MODEL`.
- **Chunking** — default chunk size lifted to 8,000 characters with page/chapter/section metadata surfaced into the `chunks` table.
- **Document display name** — `documents.original_filename` is the user-visible string; the OS temp path used during ingest never reaches the UI.
- **Session detail response** — now returns `{ session, messages, documents, artifacts }` in a single round-trip.
- **Auto-titling** — session titles are derived from the first line of the first user message (max 60 chars).
- **Home → Session handoff** — `/sessions/<id>?prompt=…&audience=…` passes the initial prompt so the session page can render the user message and open SSE immediately.

### Removed

- **`librarian_agents_team.py`** — the original synchronous prototype.
- **`advanced_examples.py`** — scenario demos that depended on the sync prototype.
- **`test_example.py`** — end-to-end workflow demo that depended on the sync prototype.
- **Earlier README version-history section** — superseded by this file.

### Fixed

- **Session retrieval** — replaced `execute_fetchone` with explicit `execute` + `fetchone` to align with `aiosqlite`'s API.
- **Database initialisation** — `_init_db` guards against re-entry via a module-level `_db_initialised` flag; the `get_db()` async context manager initialises lazily on first use.
- **Live context meter** — seeded from `GET /api/sessions/{id}/context` on session load so the bar is never stuck at 0%.
- **EventBus replacement** — `ensure_live` replaces a closed bus so a new run doesn't publish into a dead queue.

### Security

- **FTS5 injection hardening** — see `_fts5_safe` above.
- **CORS allowlist** — `http://localhost:3000` and `http://127.0.0.1:3000` only; tighten or extend deliberately before deploying.

---

## [1.x] — Synchronous prototype era *(reconstructed)*

Prior to the 2.0 revamp, the project shipped as a single-file synchronous agent system built on the Anthropic SDK. There were no numbered releases; this entry captures the shape of the code at the point the rewrite began.

### Feature set

- `LibrarianAgentsTeam` — a synchronous orchestrator + workers implementation in [librarian_agents_team.py](librarian_agents_team.py) (removed in 2.0).
- Multi-format document loader (`DocumentLoader`) and chunker (`DocumentChunker`) — both retained in 2.0.
- Prompt caching on librarian agents ([`3b52527a added prompt caching to librarian agents team`](https://github.com/wei-kiat-tan/GenAI/commits/main)).
- Scenario demos (`advanced_examples.py`) and an end-to-end smoke test (`test_example.py`) — both removed in 2.0.
- Project summary documentation in `PROJECT_SUMMARY.md` (later consolidated into README).
- README and ARCHITECTURE documentation describing the sync prototype.

### Notable commits during this era

- `ff8f39e9` — initial `LibrarianAgentsTeam` implementation.
- `3b52527a` — prompt caching added to the librarians.
- `694dbd18` — ReadME overhaul.
- `81a2bb0a` — version history section added to README.
- `f6eb556d` / `80d69e2c` — README updates.
- `d5ed05bd` — removed the inline `__main__` demo from `document_chunker.py`.

---

## [0.x] — Initial sync prototype *(reconstructed)*

The project started as a small experiment around the Anthropic API with ad-hoc scripts.

### Notable commits

- `e2744efa`, `272bbddc` — initial file uploads.
- `abac4f35` — Anthropic model and `max_tokens` adjustments.
- `d13bb627` / `47e3f06a` — early test fixtures (`testing2`).
- `282e149a` — rename `librarian-multi-agents` to `spare`.

---

## Conventions for future entries

- Group changes under **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.
- Link to relevant source files and commits where it clarifies scope.
- Date each release (`YYYY-MM-DD`) when cut. Unreleased work sits under a `[Unreleased]` heading at the top.
- Bump the frontend `package.json` version and (if the API contract changes) the FastAPI `app.version` in lockstep with each release.
