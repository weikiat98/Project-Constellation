# Changelog

All notable changes to Constellation are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-2.0 entries are reconstructed retroactively from git history and therefore list the significant changes per era rather than a per-commit log.

---

## [2.3.0] — 2026-04-29: Adaptive thinking, run cancellation, chunker & robustness fixes

### Added

- **Run cancellation endpoint** — `POST /api/sessions/{id}/cancel` signals the in-flight Lead run to stop at its next iteration. The Lead exits cleanly (emits `final_message` + `run_complete`) and the session row transitions to `last_run_state = "cancelled"`. Idempotent — calling on an idle session returns `{ cancelled: false }`. Per-session `asyncio.Event` objects are tracked in `_cancel_events`; stale events are dropped in `_run`'s `finally` block so they can't abort a subsequent run. See [backend/app.py](backend/app.py).
- **Idle SSE stream guard** — `GET /api/sessions/{id}/stream` now checks `last_run_state` before subscribing to the event bus. If no run is in flight, it returns a one-shot synthetic `run_complete` event and closes immediately, preventing the consumer from hanging indefinitely on an empty queue.
- **`document_exists()` helper** — new `async def document_exists(document_id)` in [backend/store/sessions.py](backend/store/sessions.py). Used by extractor tasks to abort gracefully if the document is deleted between upload and extraction, preventing orphan row inserts.
- **Safe extractor task wrapper** — `_safe_extract` in [backend/app.py](backend/app.py) wraps each background extractor call to swallow exceptions as warnings and skip the run if the document no longer exists, eliminating "Task exception was never retrieved" noise.
- **Plain-text artifact citation links** — plain-text artifacts in [ArtifactPreview](frontend/components/ArtifactPreview.tsx) now render via a `PlainTextWithCitations` component that parses and injects clickable `CitationLink` elements, consistent with Markdown and HTML artifact rendering.
- **Centralised citation regex** — citation UUID pattern is now defined once in [frontend/lib/citations.ts](frontend/lib/citations.ts) and imported by all consumers (`ChatPane`, `CitationLink`, `ArtifactPreview`), eliminating drift between implementations.
- **Citation cache cleared on document deletion** — deleting an uploaded document from a session now also purges that document's citation cache entries so stale source-drawer lookups no longer return dead data.
- **AbortController in SourceDrawer** — [SourceDrawer](frontend/components/SourceDrawer.tsx) now creates an `AbortController` per fetch and cancels the in-flight request when the user switches chunks quickly, preventing stale responses from overwriting fresher results.
- **Artifact preview panel width on resize** — [ArtifactPreview](frontend/components/ArtifactPreview.tsx) now recalculates its available width on `window.resize` events so the panel doesn't overflow or collapse after the user resizes the browser window.

### Changed

- **Default Lead model changed to `claude-sonnet-4-6`** — Haiku (`claude-haiku-4-5-20251001`) proved unreliable for audience register differentiation; Sonnet is the new development default. The comment in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) was updated accordingly. `ANTHROPIC_MODEL` still overrides all three roles.
- **Adaptive thinking enabled on Sonnet / Opus** — `run_lead` now passes `{"type": "adaptive"}` as the `thinking` parameter when `MODEL` is `claude-sonnet-4-6` or `claude-opus-4-7`. Interleaved thinking is automatically active, letting the model reason between tool calls. The stream handler was reworked to iterate raw events (`content_block_delta`) and dispatch `thinking_delta` blocks to the Thinking panel and `text_delta` (between-tool prose) also to the panel.
- **Final answer delivered as server-side `text_delta` chunks** — previously the final answer was sent as a single `final_message` and the frontend used a client-side typewriter (`useTypewriter`). The Lead now chunks the answer into 20-character segments, emitting each as a `text_delta` with a 15 ms sleep between them so the SSE consumer flushes each delta incrementally. The `final_message` event still follows immediately to give the frontend the canonical full answer.
- **Token counting respects attached document IDs** — `POST /api/sessions/{id}/count_tokens` now accepts `attached_document_ids` in the request body (`TokenCountRequest`) and filters the doc-index to only the attached documents, matching what `run_lead` actually sends to the model. Resolves C3 in BUG_REPORT.md.
- **Token counting no longer wraps prompts for document-free sessions** — when no documents are attached the `count_tokens` endpoint passes `body.content` verbatim instead of wrapping it in the `## Document Index … ## User Question` template, keeping the estimate aligned with the actual API call.
- **Manual compaction endpoint clarified** — `POST /api/sessions/{id}/compact` now documents that it runs the compactor but **does not persist the result**. Response body includes `persisted: false` and a note explaining this is a health-check/preview only — real compaction happens automatically during runs.
- **FTS5 safety extended for legal queries** — `_fts5_safe` in [backend/store/sessions.py](backend/store/sessions.py) now tokenises on `[\w.\-/§()]+` (preserving dots, hyphens, slashes, and section signs) so queries like `"U.S.C. § 12"` or `"Section 12(3)(a)"` survive tokenisation as meaningful phrases. Purely-punctuation tokens are stripped post-split.
- **`PRAGMA foreign_keys=ON` moved to per-connection setup** — SQLite FK enforcement is a per-connection setting. The pragma was moved out of the DDL block (which only runs once) into `_init_db` before the `_db_initialised` guard so every connection enables it. Previously, all connections after the first ran with FK enforcement silently disabled, breaking `ON DELETE CASCADE`.
- **Professional audience sentence-length range widened** — `_AUDIENCE_INSTRUCTIONS["professional"]` sentence-length guidance updated from `15–30 words` to `20–40 words` for a more natural register.
- **`runArtifactIds` race condition fixed** — functional state updates now used when accumulating artifact IDs during a run, preventing flickering artifact cards caused by stale closure captures.

### Fixed

- **Document chunker page numbers** — `chunk_by_pages` was iterating `pages` at stride 2 starting from index 0, misreading the structure returned by `re.split` with a capturing group (which places the captured page number at odd indices). Rewritten to correctly consume `(page_num_str, page_body)` pairs starting at index 1, so chunk metadata reflects actual page numbers from the document.
- **Document loader error messages** — error messages for missing PDF/DOCX parsers now reference `requirements.txt` for installation instead of bare `pip install` commands.

### Schema changes

- `last_run_state` gains a fourth value: `"cancelled"` (alongside `idle | running | completed | error`). Existing rows are unaffected (they hold one of the prior three values).
- `TokenCountRequest` gains an optional `attached_document_ids: list[str]` field.

---

## [2.2.0] — 2026-04-26: UAT-driven fix release

This release closes every issue logged in the [25 April 2025 UAT pass](UAT/25April_UAT%20Checklist.md) plus the free-form observations. Detailed root-cause analysis and per-fix verification are in [UAT/25April_UAT_Resolution_Plan.md](UAT/25April_UAT_Resolution_Plan.md).

### Added

- **`last_run_state` on sessions** — new `sessions.last_run_state TEXT NOT NULL DEFAULT 'idle'` column with state machine (`idle | running | completed | error`). Set to `running` in `submit_message` ([backend/app.py](backend/app.py)) and to a terminal state in the `_run` finally block. Surfaced on `SessionOut` so the frontend can detect an in-flight run on session mount and re-subscribe to the SSE bus. Resolves UAT 20.1–20.3 (multi-session run management).
- **Multi-session SSE re-attach** — the session page in [frontend/app/sessions/[id]/page.tsx](frontend/app/sessions/%5Bid%5D/page.tsx) now reads `last_run_state` on mount and calls `attachStream()` automatically if the backend is still running. Persisted trace fills any gap that occurred while the user was away. EventSource is closed on unmount so navigating between sessions doesn't leak connections.
- **Per-message document attachments** — new `messages.attached_document_ids_json` column. `MessageCreate` accepts `attached_document_ids: list[str]`; `MessageOut` exposes both `attached_document_ids` and a hydrated `attached_documents` (filenames). The session page passes `documents.map(d => d.id)` on every send / retry / edit, so user-bubble document chips re-render correctly after page reload. Resolves UAT 7.4.
- **Typewriter completion callback** — `useTypewriter` in [frontend/components/ChatPane.tsx](frontend/components/ChatPane.tsx) now exposes an `onComplete` callback that fires exactly once per fully-revealed recap. The session page uses this to flush a deferred `run_complete` commit (held in `pendingCommitRef`) so the live streaming bubble is no longer unmounted mid-animation. Resolves UAT 9.1, 9.2, 9.3, 9.11 (typewriter never animated).
- **`DELETE /api/sessions/{id}/documents/{id}` endpoint** — removes an uploaded document from a session. Returns 409 if the document is referenced by a persisted message (so chip rendering on past turns isn't broken). Trash icon appears on hover in the Session files popover ([frontend/components/SessionFiles.tsx](frontend/components/SessionFiles.tsx)). Closes the free-form "cannot delete uploaded session files" observation.
- **Audience-mode banner in chat** — `ChatMessage.role` widened to include `"system"`, with a `systemKind: "audience_change"` variant rendered as a centred italic banner (`~ switched to layperson mode ~`). Banner is emitted on explicit toggle clicks and on prompt-inferred audience switches. Closes the free-form "show a switched-to-X banner" observation.
- **Copy button in Artifact preview** — added between Download and Close in [frontend/components/ArtifactPreview.tsx](frontend/components/ArtifactPreview.tsx), with a 1.5 s ✓ confirmation. Closes the free-form "copy button alongside download and close" observation.
- **Self-sizing artifact card** — [frontend/components/ArtifactCard.tsx](frontend/components/ArtifactCard.tsx) now uses `inline-flex max-w-sm` instead of `w-full`, and the wrapping container in `ChatPane` switched from `space-y-2 max-w-[90%]` to `flex flex-col items-start gap-2`. The card hugs its title up to ~24 rem and only then truncates. Closes the free-form "reduce artifact button size" observation.

### Changed

- **Audience prompts rebuilt for actual register diversity** — `_AUDIENCE_INSTRUCTIONS` in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) and the matching dictionary in [backend/orchestrator/subagent.py](backend/orchestrator/subagent.py) replaced the previous one-line hints with multi-paragraph briefs containing reader profile, forbidden vocabulary patterns, required vocabulary patterns, and a worked example for each level showing the same fact phrased three ways. The audience block was also **hoisted from the bottom of the system prompt to immediately after the opening paragraph**, which makes it load-bearing for the model. Total system prompt size grew from ~3.5 K to ~7 K characters per audience. Resolves UAT 14.2–14.4.
- **Finalize-time audience self-check** — new `_AUDIENCE_FINALIZE_CHECK` block injected into the Lead system prompt instructing the model to re-read its `result` against the audience brief and rewrite any sentence that violates it (e.g. a layperson answer that smuggles in a section number).
- **Cumulative context meter** — the `context_usage` event in [backend/orchestrator/lead.py](backend/orchestrator/lead.py) now counts persisted session history (`get_messages()`) plus the in-flight Lead loop buffer, so the meter grows monotonically across turns and only dips on compaction. Previously it reset to ~5–10% on every new turn. Resolves UAT 16.2 and the related "token counter / context meter discrepancy" observation. The remaining gap between TokenCounter (which includes system + tools + doc index) and ContextMeter (which doesn't) is a known scope difference, not a bug.
- **Subagent `agent_done` summary cap raised** — from 200 chars to 2000 chars in [backend/orchestrator/subagent.py](backend/orchestrator/subagent.py). The trace UI in [frontend/components/AgentTrace.tsx](frontend/components/AgentTrace.tsx) now shows an 80-char preview when the row is collapsed and the full text in a scrollable monospace block when expanded (replaced `line-clamp-3`). Resolves UAT 12.6.

### Fixed

- **Persisted `thinking` field is no longer empty after `finalize`** — [backend/orchestrator/event_bus.py](backend/orchestrator/event_bus.py) no longer wipes `_thinking_buffer` on `thinking_clear`. The `thinking_clear` event remains a UI-only signal (drop the live panel display); the server-side buffer is the historical record and must be preserved so the persisted assistant message has a non-empty `thinking` field. Resolves UAT 19.9 (collapsible past-turn thinking panel).
- **Stream-close handler no longer races the typewriter** — the `onClose` callback in `attachStream` now early-returns if `pendingCommitRef.current` is set, so the stream-end refetch can't clobber the live streaming state while the typewriter is still revealing the recap.

### Schema migrations (idempotent, run on first connection)

- `ALTER TABLE sessions ADD COLUMN last_run_state TEXT NOT NULL DEFAULT 'idle'`
- `ALTER TABLE messages ADD COLUMN attached_document_ids_json TEXT`

Verified clean on the existing `deep_reading.db` (13 sessions preserved, both columns present after migration).

### Verification

- `python ast.parse` clean on all 6 edited backend files.
- `tsc --noEmit` shows zero new errors in any edited frontend file (4 pre-existing CitationLink errors are out of scope).
- `from backend.app import app` succeeds; route count grew 19 → 20 with the document-delete endpoint.
- `_LEAD_SYSTEM` audience block now appears at character 361 (~6% into the prompt) for all three audiences, vs. trailing the prompt previously.

Items still requiring live UAT (cannot be desk-verified): typewriter speed feel, audience output diversity (3-audience same-prompt comparison), multi-session re-attach end-to-end, and the previously-NA compaction flow.

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
