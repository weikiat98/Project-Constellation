# Constellation : UAT Checklist

**Version under test:** 2.3.3 (+ post-2.3.3 thought-process citation fragment fix)
**Tester:** _______________
**Date:** _______ July 2026 ________
**Environment:** [ ] Local dev  [ ] Staging  [ ] Production
**Backend model (`ANTHROPIC_MODEL`):** _______________
**Advisor model (`ADVISOR_MODEL`, optional):** _______________
**Browser / OS:** _______________

---

## How to use this document

1. Work through sections in order. Sections later in the doc assume you've completed the earlier ones (e.g. session-page checks assume a session exists).
2. For each checklist item, mark one of:
   - **P** = Pass (behaved as described)
   - **F** = Fail (did not behave as described : log in the Issue Log)
   - **NA** = Not applicable / couldn't test (note why in the Issue Log)
3. Every **F** gets a row in the **Issue Log** at the bottom. Include the section + item number, what you saw, what you expected, and (if possible) reproduction steps + screenshot/video path.
4. Submit this completed file back in one go so all issues can be addressed in a single pass.

### What's new vs. the April pass

This pass covers all changes shipped in **v2.2.0 → v2.3.3** plus the post-2.3.3 hotfix for character-level interleaving of subagent thinking deltas. Sections that exercise behaviour added or rewritten since v2.1:

- §7.10–§7.13, §9 : three-step artifact reveal sequence, `run_complete` ordering, SSE close-race guard, server-side text_delta typewriter
- §8.12–§8.14 : adaptive thinking events, per-subagent thought-process fragments (today's hotfix)
- §10.10–§10.13 : copy button in artifact preview, plain-text artifact citation links, panel width on resize
- §13.12–§13.14 : multi-session re-attach using `last_run_state`
- §14 : rebuilt audience prompts + finalize-time self-check
- §16 : cumulative context meter, cached token-counter baseline, ContextMeter decoupled from its own fetch
- §18.8–§18.12 : run cancellation endpoint, structured error banners, rate-limit retry behaviour
- §19, §21 : per-message attached-doc chips, persisted thinking field, document delete endpoint, artifact catalogue in Lead context, conversation history folded into Lead messages
- §22 : citation validity check (hallucinated UUID flagging), citation cache invalidation, CitationLink null retry, subagent valid-chunk-ID vocabulary restriction
- §27 : follow-up prompt continuity (conversation history grounding) : new section

---

## Pre-flight

- [P] Backend running on `http://localhost:8000` (`uvicorn backend.app:app --reload --port 8000`)
- [P] Frontend running on `http://localhost:3000` (`npm run dev` in `frontend/`)
- [P] `ANTHROPIC_API_KEY` is set in the backend environment
- [P] `deep_reading.db` file exists after first backend start
- [P] On first start, backend logs show **no errors** for the two `ALTER TABLE` migrations (`last_run_state`, `attached_document_ids_json`)
- [P] Browser DevTools Console open : note any red errors throughout (put them in the Issue Log)
- [P] Browser DevTools Network tab open : watch for failed requests (red rows)
- [NA] (Optional) `ADVISOR_MODEL=claude-opus-4-7` set if you want to exercise the advisor tool path (§8.14)
- [NA] (Optional) `ANTHROPIC_MAX_CONCURRENCY`, `ANTHROPIC_MAX_RETRIES`, `ANTHROPIC_BASE_BACKOFF`, `ANTHROPIC_MAX_BACKOFF` left at defaults unless explicitly stress-testing rate-limit behaviour (§18.10–§18.12)

**Test documents to prepare (place in a `uat/fixtures/` folder):**

- [P] A small PDF (~5 pages) : e.g. the Condensed Wealth of Nations
- [P] A medium PDF (~30–50 pages)
- [P] A large PDF (~150+ pages) : to stress the chunker + context meter
- [P] A `.docx` file
- [P] A `.txt` file
- [P] A `.md` file
- [P] An `.html` file
- [P] An **unsupported** file (e.g. `.xlsx` or `.png`): for negative testing
- [NA] A **corrupt** file (rename a random binary to `.pdf`): for negative testing
- [NA] A file with a **very long name** (>80 chars before the extension)
- [NA] A file with **non-ASCII characters** in the name (e.g. `Réglementation_française.pdf`)
- [P] A **legal/regulatory document** containing section references (e.g. `Section 12(3)(a)`, `U.S.C. § 12`): to exercise FTS5 safety (§22.10)
- [P] A document that produces **multiple subagent spawns** when summarised: required for §8.12 (interleaving fix)

---

## 1. Splash page (`/`)

| # | Item | P / F / NA |
|---|---|---|
| 1.1 | Splash page loads at `http://localhost:3000/` within 2s | [ ] |
| 1.2 | "Constellation" title is visible and readable over the background | [ ] |
| 1.3 | Subtitle paragraph is visible and readable | [ ] |
| 1.4 | Background image is visible (not black / not broken image) | [ ] |
| 1.5 | Background crossfades to a new image roughly every 6 seconds | [ ] |
| 1.6 | Crossfade is smooth (no flash of black / no jump cut) | [ ] |
| 1.7 | All 6 slide images load without broken-image icons (check DevTools → Network) | [ ] |
| 1.8 | **START** button is visible, centred, and large | [ ] |
| 1.9 | START button uses the white-on-dark palette (not the old blue) | [ ] |
| 1.10 | Clicking **START** navigates to `/home` | [ ] |
| 1.11 | Resizing the browser (narrow → wide) keeps the layout intact | [ ] |
| 1.12 | Page works on a ≥1280px wide window | [ ] |
| 1.13 | Page works on a narrow (~768px, tablet-size) window | [ ] |
| 1.14 | Page works on a phone-width (~375px) window | [ ] |

---

## 2. Home page (`/home`) : empty state

| # | Item | P / F / NA |
|---|---|---|
| 2.1 | Greeting matches time of day ("Good morning" / "Good afternoon" / "Good evening" / "Still up" if before 5am) | [ ] |
| 2.2 | Subtitle "Ask a question or upload a document to begin." is visible | [ ] |
| 2.3 | Prompt bar is visible below the greeting (roughly 30% down the viewport) | [ ] |
| 2.4 | Audience toggle at the top shows 3 options: **Layperson / Professional / Expert** | [ ] |
| 2.5 | **Professional** is selected by default for a fresh visit | [ ] |
| 2.6 | Clicking each audience option visibly highlights the chosen one (white background, slate-900 text) | [ ] |
| 2.7 | Token counter displays `0 tokens` (or similar) when the input is empty | [ ] |
| 2.8 | Typing in the input : token counter updates within ~800ms after you stop typing | [ ] |
| 2.9 | Token count is roughly `prompt length / 4` before any upload (e.g. 100 chars ≈ 25 tokens) | [ ] |
| 2.10 | Left sidebar is visible : empty or showing prior sessions from the DB | [ ] |
| 2.11 | **+** button next to the input opens a popover with "Upload files" | [ ] |
| 2.12 | Clicking outside the popover closes it | [ ] |
| 2.13 | Pressing **Enter** on an empty input does nothing (does not submit) | [ ] |
| 2.14 | Pressing **Shift+Enter** on the input inserts a newline | [ ] |
| 2.15 | **+ New chat** button in the sidebar uses the white-on-dark palette | [ ] |
| 2.16 | Send button on the home prompt bar uses the white-on-dark palette | [ ] |

---

## 3. Home page : file upload (click)

| # | Item | P / F / NA |
|---|---|---|
| 3.1 | Clicking + → "Upload files" opens the OS file picker | [ ] |
| 3.2 | Uploading a small PDF : "Ingesting…" spinner appears | [ ] |
| 3.3 | After ingest, a chip with the filename + 📄 icon appears above the input | [ ] |
| 3.4 | "1 ready" indicator with a green checkmark appears | [ ] |
| 3.5 | Token counter updates to reflect the ingested document tokens (should jump substantially) | [ ] |
| 3.6 | Uploading a second file : a second chip appears | [ ] |
| 3.7 | Clicking the **×** on a chip removes that file from the pending list | [ ] |
| 3.8 | Filename in the chip is truncated if long (with full name on hover) | [ ] |
| 3.9 | A draft session appears in the left sidebar once the first upload succeeds | [ ] |
| 3.10 | Uploading an unsupported file shows a red **structured error panel** (layman text + "Show technical details" toggle), not a plain red string | [ ] |
| 3.11 | The structured error panel's "Show technical details" toggle reveals the HTTP status, error code, and raw exception | [ ] |

---

## 4. Home page : drag-and-drop upload

| # | Item | P / F / NA |
|---|---|---|
| 4.1 | Dragging a file over the home page shows a blue dashed overlay with "Drop files to upload" | [ ] |
| 4.2 | Dragging the file out of the window removes the overlay | [ ] |
| 4.3 | Dropping the file uploads it (chip appears, token count updates) | [ ] |
| 4.4 | Dropping multiple files at once uploads them sequentially (all chips appear) | [ ] |

---

## 5. Home page : file format coverage

Upload each file type. Confirm it produces a chip **or** surfaces a readable structured error.

| # | File type | Result (chip ✓ / structured error text) |
|---|---|---|
| 5.1 | `.pdf` (valid, small) | [ ] |
| 5.2 | `.docx` | [ ] |
| 5.3 | `.txt` | [ ] |
| 5.4 | `.md` | [ ] |
| 5.5 | `.html` | [ ] |
| 5.6 | `.xlsx` or another unsupported type : shows a structured error panel | [ ] |
| 5.7 | Corrupt `.pdf` (random bytes renamed) : shows a structured error, not a silent success | [ ] |
| 5.8 | File with non-ASCII filename : chip displays the filename correctly | [ ] |
| 5.9 | File with very long filename : chip truncates with ellipsis; full name on hover | [ ] |
| 5.10 | Uploading a large PDF (~150 pages) : ingest completes in a reasonable time (note the duration: ___ s) | [ ] |
| 5.11 | A document deleted (via the session files menu) **during** background extraction does not produce a "Task exception was never retrieved" log noise on the backend | [ ] |

---

## 6. Home page : start chat

| # | Item | P / F / NA |
|---|---|---|
| 6.1 | With input filled + file attached, the **Send** (↑ or ➤) button is enabled | [ ] |
| 6.2 | With empty input + no file, the Send button is disabled | [ ] |
| 6.3 | With empty input + file attached, Send is enabled (file-only submission allowed) | [ ] |
| 6.4 | Clicking Send navigates to `/sessions/<id>` | [ ] |
| 6.5 | The URL carries `?prompt=...&audience=...` on first submit | [ ] |
| 6.6 | URL query string is cleared after the session page mounts | [ ] |
| 6.7 | Pressing **Enter** (without Shift) submits the same as clicking Send | [ ] |

---

## 7. Session page : initial load after handoff

| # | Item | P / F / NA |
|---|---|---|
| 7.1 | Session page loads without a full page flash (no white flash) | [ ] |
| 7.2 | URL query string (`?prompt=...`) is cleared after initial load | [ ] |
| 7.3 | The user's submitted prompt appears as a user bubble (right-aligned, blue) | [ ] |
| 7.4 | **Attached document chips appear inside the user bubble** (with the filename + small file icon) : fixed in v2.2.0 | [ ] |
| 7.5 | A "Thinking…" panel appears below with a pulsing live indicator | [ ] |
| 7.6 | Status text shows something like "Agents are starting up…" initially | [ ] |
| 7.7 | Within ~5–10 seconds, the thinking panel shows agent activity | [ ] |
| 7.8 | Agent Trace panel (bottom of chat) populates with `agent_spawned` / `tool_use` rows | [ ] |
| 7.9 | The audience toggle in the header reflects the audience from the URL | [ ] |
| 7.10 | The artifact preview canvas does **not** open the moment `artifact_written` fires : it stays closed until after the recap text has begun pacing into the bubble (three-step reveal sequence) | [ ] |
| 7.11 | After `run_complete` fires, the streaming bubble swaps cleanly to the persisted assistant message (no partial-text hang requiring a refresh) | [ ] |
| 7.12 | After the swap, the "Generated files" button appears below the recap | [ ] |
| 7.13 | ~600ms after the bubble swap, the artifact preview canvas slides in on the right | [ ] |

---

## 8. Session page : active streaming run

While the agents are working (before `finalize`):

| # | Item | P / F / NA |
|---|---|---|
| 8.1 | Thinking panel streams new text as agents progress (text grows over time) | [ ] |
| 8.2 | Thinking panel auto-scrolls as new content arrives | [ ] |
| 8.3 | Thinking panel's **Hide / Show** toggle works | [ ] |
| 8.4 | Agent Trace panel shows `agent_spawned: lead_orchestrator` as the first entry | [ ] |
| 8.5 | Subsequent `tool_use` rows show tool names (`read_document_chunk`, `search_document`, etc.) | [ ] |
| 8.6 | When `spawn_subagent` is called, a new `agent_spawned` entry appears for each subagent | [ ] |
| 8.7 | When `write_artifact` is called, a `tool_use: write_artifact` entry appears | [ ] |
| 8.8 | Context Meter bar at the bottom of the input area updates over time | [ ] |
| 8.9 | Context Meter percentage is never above 100% (cap is respected) | [ ] |
| 8.10 | The **Send** button is replaced with a red **Stop** (■) button while streaming | [ ] |
| 8.11 | Typing in the input is disabled while streaming (input is greyed out) | [ ] |
| 8.12 | **Subagent thought-process fragments stay intact** : when the Lead spawns ≥2 subagents in parallel, citation UUIDs in the Thinking panel render as `[filename p.N]` pills, **not** as garbled fragments like `todaf-421d-a53c-15`, `[107c814acb5334db81]`, or `406c-9537-5d8bf6d768fc]` (post-2.3.3 hotfix) | [ ] |
| 8.13 | Each subagent's thinking output is prefixed with its role on its own line (e.g. `\n\n[Document analyser]\n…`) so concurrent agents are visually separated | [ ] |
| 8.14 | (Optional, advisor mode only : `ADVISOR_MODEL` set) Advisor responses appear in the thinking panel prefixed with `[Advisor]` | [ ] |

---

## 9. Session page : final output delivery (CRITICAL)

These checks cover the typewriter + three-step artifact reveal contract introduced in v2.2 and refined in v2.3.3.

| # | Item | P / F / NA |
|---|---|---|
| 9.1 | When the Lead calls `finalize`, the final message begins **typing in letter-by-letter** (typewriter animation, server-paced via `text_delta` chunks) : the recap should not appear in one chunk | [ ] |
| 9.2 | The typewriter speed feels natural : not instant, not sluggish (should take ~8–12s for a ~500-word recap) | [ ] |
| 9.3 | A blinking cursor ▋ appears at the end of the text while it's typing | [ ] |
| 9.4 | The thinking panel collapses (or its content clears) when the final message starts streaming : no duplication of the recap inside "Thinking…" | [ ] |
| 9.5 | If an artifact was produced this turn, a **"Generated files"** section with a file button appears below the streaming text (while it's still typing, or just after) | [ ] |
| 9.6 | The file button shows the artifact name (e.g. "Adam Smith's Wealth of Nations: Key Concepts Summary") | [ ] |
| 9.7 | The file button **hugs its title up to ~24 rem** then truncates : not a full-width row | [ ] |
| 9.8 | Clicking the file button opens the **Artifact Preview** canvas on the right side of the window | [ ] |
| 9.9 | About ~600ms after the bubble swap, the Artifact Preview **auto-opens** on the right (if an artifact was produced) | [ ] |
| 9.10 | The Artifact Preview does NOT pop open mid-stream in a jarring way (it should feel deliberate, after text has begun) | [ ] |
| 9.11 | The chat column shrinks to make room for the preview (no overlap) | [ ] |
| 9.12 | After streaming finishes, the blinking cursor disappears | [ ] |
| 9.13 | The assistant bubble now shows a **Copy** and **Retry** action row | [ ] |
| 9.14 | No red console errors during the `final_message` / `run_complete` transition | [ ] |
| 9.15 | `TypeError: Cannot read properties of null` does NOT appear anywhere in the console | [ ] |
| 9.16 | `live_context_percent` clears (the bar resets to the post-run accurate value from `count_tokens`) within ~1s of `run_complete` | [ ] |
| 9.17 | A second send within the same session works : the typewriter animates again, no stale state from the first run | [ ] |

---

## 10. Artifact Preview canvas

| # | Item | P / F / NA |
|---|---|---|
| 10.1 | Preview canvas slides in from the right (not a jump-cut) | [ ] |
| 10.2 | Preview renders Markdown artifacts as formatted HTML (headings, bullets, tables) | [ ] |
| 10.3 | HTML artifacts render with styles applied | [ ] |
| 10.4 | CSV artifacts render as a table | [ ] |
| 10.5 | Plain-text artifacts render with clickable inline citation links (not raw `[uuid]` strings) | [ ] |
| 10.6 | Citations inside the artifact (`[uuid]`) are clickable | [ ] |
| 10.7 | Clicking a citation in the artifact opens the **Source Drawer** on the right (or overlays) with the chunk contents | [ ] |
| 10.8 | A **Copy** button is visible between the Download and Close buttons in the preview header | [ ] |
| 10.9 | Clicking Copy copies the artifact contents and shows a 1.5 s ✓ confirmation | [ ] |
| 10.10 | Clicking the × button on the preview closes it and returns the chat column to full width | [ ] |
| 10.11 | Download button downloads the raw artifact (citations resolved to `[filename p.N]` for non-CSV formats) | [ ] |
| 10.12 | Resizing the browser window mid-preview : the canvas width re-calculates (no overflow, no collapse) | [ ] |
| 10.13 | Opening an artifact, closing it, and reopening it from the session files menu works repeatedly without glitches | [ ] |

---

## 11. Inline citations in the recap

| # | Item | P / F / NA |
|---|---|---|
| 11.1 | Citations in the assistant message appear as `[filename p.N]` (or `[filename §id]` for sectioned docs), **not** as raw `[uuid]` | [ ] |
| 11.2 | Hovering a citation shows a tooltip with `View source : <filename> (p.N)` | [ ] |
| 11.3 | Hovering a citation changes the cursor to a pointer | [ ] |
| 11.4 | Clicking a citation opens the **Source Drawer** with the referenced chunk | [ ] |
| 11.5 | Source Drawer shows: chunk text, section (if any), page (if any), filename | [ ] |
| 11.6 | Switching between citations quickly does **not** show stale chunk content (AbortController in SourceDrawer cancels in-flight requests) | [ ] |
| 11.7 | Closing the drawer (× or click outside) works | [ ] |
| 11.8 | Multi-citation blocks `[uuid, uuid]` show each citation as a separate clickable element | [ ] |
| 11.9 | If a citation lookup initially returns `null` during streaming, it automatically retries ~2s later and the label updates from raw UUID to `[filename p.N]` | [ ] |
| 11.10 | Clicking a citation whose chunk has been deleted from the session does not crash the drawer : it shows a "not found" / empty state | [ ] |

---

## 12. Agent Trace panel

| # | Item | P / F / NA |
|---|---|---|
| 12.1 | Trace panel is collapsible (click header to expand/collapse) | [ ] |
| 12.2 | Trace entries show a timestamp and an icon per event type | [ ] |
| 12.3 | `agent_spawned` rows show the agent's role | [ ] |
| 12.4 | `tool_use` rows show the tool name and expandable input JSON | [ ] |
| 12.5 | `artifact_written` rows show the artifact name | [ ] |
| 12.6 | `agent_done` rows show **up to 2000 chars** of the subagent summary (collapsed: 80-char preview; expanded: full text in a scrollable monospace block) : not cut off at 200 chars | [ ] |
| 12.7 | `compaction_done` rows show before/after token counts | [ ] |
| 12.8 | Trace survives a browser refresh (reload the page : events reappear) | [ ] |
| 12.9 | Trace survives switching to another session and back (no duplication) | [ ] |

---

## 13. Chat sidebar

| # | Item | P / F / NA |
|---|---|---|
| 13.1 | Sidebar lists all sessions, most recent first | [ ] |
| 13.2 | Active session is highlighted | [ ] |
| 13.3 | Clicking a different session navigates to it without a full page flash | [ ] |
| 13.4 | Session titles auto-generate from the first user message after first send | [ ] |
| 13.5 | Pin button on a session row moves it to a pinned group (top) | [ ] |
| 13.6 | Unpinning moves it back to the regular list | [ ] |
| 13.7 | Rename via pencil icon lets you edit the title inline | [ ] |
| 13.8 | Rename persists after page refresh | [ ] |
| 13.9 | Delete button prompts for confirmation (or uses a destructive style) | [ ] |
| 13.10 | Deleting a session removes it from the list and navigates away if it was active | [ ] |
| 13.11 | Deleting a session does NOT leave an orphaned route (no 404 on the now-dead URL) | [ ] |
| 13.12 | A session with an in-flight run has a visible "running" indicator (if applicable) | [ ] |
| 13.13 | Reloading the page while a run is in flight automatically re-attaches the SSE stream (based on `last_run_state`) : the in-progress recap continues from where it was | [ ] |
| 13.14 | Closing the browser tab and reopening the session while the run is still active reattaches correctly; persisted trace fills any gap | [ ] |

---

## 14. Audience toggle

Test all three levels on the **same document + same question** to confirm the output meaningfully differs.

| # | Item | P / F / NA |
|---|---|---|
| 14.1 | Switching audience persists across reload (session detail endpoint saves it) | [ ] |
| 14.2 | **Layperson** mode produces plainer language: short sentences (≤20 words), everyday verbs, no Latin / no statute numbers / no unexpanded acronyms | [ ] |
| 14.3 | **Professional** mode produces business/technical language: 20–40 word sentences, acronyms expanded on first use, section references where they aid navigation | [ ] |
| 14.4 | **Expert** mode produces technical / precise / domain-specific language: full statutory references in canonical form, Latin terms where they carry specific meaning | [ ] |
| 14.5 | The three audience outputs for the **same prompt + same document** are visibly different in register (not just paraphrases of one another) | [ ] |
| 14.6 | The finalize-time self-check catches register violations : a layperson reply does not silently smuggle in section numbers or Latin | [ ] |
| 14.7 | Typing "explain in layman's terms" while Professional is selected auto-switches to Layperson | [ ] |
| 14.8 | Typing "give me the expert analysis" auto-switches to Expert | [ ] |
| 14.9 | Casual language like "simple question" does NOT falsely trigger an audience switch | [ ] |
| 14.10 | Toggling the audience (or inferring it from a prompt) shows a centred italic banner in chat: `~ switched to layperson mode ~` (or the equivalent for professional / expert) | [ ] |
| 14.11 | Audience-change banners are **transient** : they disappear on page reload (not persisted) | [ ] |

---

## 15. Retry & Edit

| # | Item | P / F / NA |
|---|---|---|
| 15.1 | Only the **last** assistant message shows a Retry button | [ ] |
| 15.2 | Clicking Retry removes the current assistant reply and re-runs the user prompt | [ ] |
| 15.3 | After retry, a new recap + new artifact (if applicable) appears in the same slot | [ ] |
| 15.4 | Every user message has an **Edit** (pencil) button | [ ] |
| 15.5 | Clicking Edit turns the bubble into a textarea with Save/Cancel | [ ] |
| 15.6 | The edit textarea retains the bubble's width (doesn't collapse) | [ ] |
| 15.7 | Saving an edit truncates all messages after it and re-runs | [ ] |
| 15.8 | Cancelling an edit restores the original bubble | [ ] |
| 15.9 | Editing a middle-of-conversation message wipes subsequent turns (not just the next one) | [ ] |
| 15.10 | Attached-doc chips on an edited message are preserved (the message keeps its `attached_document_ids`) | [ ] |
| 15.11 | After edit + re-run, attached-doc chips re-appear on the edited bubble | [ ] |

---

## 16. Context meter, token counter & compaction

| # | Item | P / F / NA |
|---|---|---|
| 16.1 | Context meter shows a percentage and a filled bar | [ ] |
| 16.2 | **Meter is cumulative across turns** : it grows monotonically as the conversation lengthens (only dips on compaction). Does NOT reset to 5–10% on every new turn | [ ] |
| 16.3 | Token counter beside the context meter shows draft + base separately and updates within ~800ms after you stop typing | [ ] |
| 16.4 | Typing into the input does **not** trigger a network request to `count_tokens` on every keystroke (Network tab → filter by `count_tokens` : there should be ≤1 per session load / doc change / run completion, not per keystroke) | [ ] |
| 16.5 | After a run completes, the token counter's base value refreshes (the new assistant message gets added to history) within ~2s | [ ] |
| 16.6 | The token counter and the context meter agree on order of magnitude : no wild discrepancy (e.g. counter says 8K, meter says 50%) | [ ] |
| 16.7 | The `/api/sessions/{id}/context` endpoint accounts for system prompt + tool definitions + doc index + history (so it matches what `run_lead` actually sends) | [ ] |
| 16.8 | ContextMeter component does **not** issue its own `/context` fetch on mount (Network tab confirms : no duplicate request) | [ ] |
| 16.9 | Clicking **Compact** manually triggers compaction (response includes `persisted: false` because manual compaction is a preview) | [ ] |
| 16.10 | During compaction, the button shows a loading state | [ ] |
| 16.11 | On a very long conversation (simulate by sending 10+ messages), auto-compaction fires at ~85% (note the actual trigger: ___%) | [ ] |
| 16.12 | After auto-compaction, the meter drops to a lower percentage | [ ] |
| 16.13 | A `compaction_done` entry appears in the Agent Trace | [ ] |
| 16.14 | After auto-compaction, the conversation still renders correctly (no missing messages) | [ ] |
| 16.15 | Token-count endpoint accepts `attached_document_ids` and only sums the attached docs (not all session docs) | [ ] |

---

## 17. In-session search

| # | Item | P / F / NA |
|---|---|---|
| 17.1 | Clicking the search icon in the input bar reveals a search field | [ ] |
| 17.2 | Typing a query highlights matches in the messages (amber/yellow highlight) | [ ] |
| 17.3 | The counter shows `1 / N` where N is the total match count | [ ] |
| 17.4 | **Enter** jumps to the next match and scrolls it into view | [ ] |
| 17.5 | **Shift+Enter** jumps to the previous match | [ ] |
| 17.6 | The current match is styled differently from other matches (more vivid highlight) | [ ] |
| 17.7 | Esc closes the search and clears the query | [ ] |
| 17.8 | Search works on both user and assistant messages | [ ] |
| 17.9 | Search does NOT match inside citation UUIDs (or if it does, it's intentional) | [ ] |
| 17.10 | Clearing the query removes all highlights | [ ] |

---

## 18. Stop, cancellation & error handling

| # | Item | P / F / NA |
|---|---|---|
| 18.1 | Clicking **Stop** during streaming halts the run within ~2s | [ ] |
| 18.2 | A "[stopped]" indicator appears on the partial reply | [ ] |
| 18.3 | After stop, input is re-enabled | [ ] |
| 18.4 | The session's `last_run_state` transitions to `"cancelled"` after Stop (verifiable via `GET /api/sessions/<id>` → `last_run_state` field) | [ ] |
| 18.5 | Calling `POST /api/sessions/<id>/cancel` on an idle session returns `{ "cancelled": false }` (idempotent : no crash) | [ ] |
| 18.6 | Killing the backend mid-stream surfaces a readable structured error banner (not a silent hang) | [ ] |
| 18.7 | Disconnecting WiFi mid-stream : UI recovers gracefully after reconnect | [ ] |
| 18.8 | An orchestrator error (e.g. Anthropic 4xx/5xx that exhausts retries) appears as an inline **ErrorBanner** in the chat : layman text by default, with a "Show technical details" toggle that reveals status, code, and raw message | [ ] |
| 18.9 | Error banners are transient : they disappear on page reload (not persisted) | [ ] |
| 18.10 | Hitting the Anthropic rate limit (429) does not crash the run : the retry wrapper backs off and either succeeds or eventually surfaces a rate-limit ErrorBanner | [ ] |
| 18.11 | A 429 with a `retry-after` header is honoured (waits at least that long before the next attempt) | [ ] |
| 18.12 | Spawning many parallel subagents does **not** exceed the concurrency semaphore (default 3) : observable via gentler ramp on the Anthropic dashboard / no 429 storms | [ ] |
| 18.13 | Sending a message with no document uploaded still works (or shows a helpful empty-state) | [ ] |
| 18.14 | Sending a nonsensical prompt ("asdfghjkl") still returns a reply without crashing | [ ] |
| 18.15 | The SSE stream endpoint for a session with no in-flight run returns a synthetic `run_complete` and closes (does not hang indefinitely) | [ ] |

---

## 19. Persistence across reloads

After a full run completes, refresh the browser (Ctrl/Cmd+R):

| # | Item | P / F / NA |
|---|---|---|
| 19.1 | The user + assistant messages all reappear in order | [ ] |
| 19.2 | Inline citations still clickable after reload | [ ] |
| 19.3 | Generated artifact buttons still visible under the right assistant message | [ ] |
| 19.4 | Clicking an artifact button after reload opens the preview canvas | [ ] |
| 19.5 | Agent trace events reappear (persisted trace) | [ ] |
| 19.6 | Context meter shows a seeded value (not stuck at 0) | [ ] |
| 19.7 | Audience toggle matches what was set before reload | [ ] |
| 19.8 | Session title matches (no reset to default) | [ ] |
| 19.9 | **Thinking panel for past turns is present and collapsed by default** : clicking the header expands it and reveals the persisted reasoning text (not blank, not missing) | [ ] |
| 19.10 | Attached-doc chips on each user message reappear correctly after reload (per-message `attached_document_ids`) | [ ] |
| 19.11 | Audience-change banners and ErrorBanners do **not** reappear after reload (transient by design) | [ ] |

---

## 20. Multi-session behaviour & SSE re-attach

| # | Item | P / F / NA |
|---|---|---|
| 20.1 | Open session A, start a run, switch to session B mid-stream : B shows its own history correctly | [ ] |
| 20.2 | Returning to A while the run is still in flight reattaches the SSE stream (uses `last_run_state == "running"`); the recap continues from where it was | [ ] |
| 20.3 | Returning to A after the run has completed shows the completed message (no duplicated messages, no partial-text hang) | [ ] |
| 20.4 | Starting a run in A then immediately in B : both runs complete and are stored under the right session | [ ] |
| 20.5 | Uploading a file in A does not appear in B's session files | [ ] |
| 20.6 | Deleting A while B is streaming does not affect B | [ ] |
| 20.7 | Navigating away from a session closes its EventSource cleanly (no leaked SSE connections : check DevTools → Network → EventStream tab) | [ ] |

---

## 21. File management within a session

| # | Item | P / F / NA |
|---|---|---|
| 21.1 | Session header's "files" menu lists all attached documents | [ ] |
| 21.2 | Session header's files menu lists all generated artifacts | [ ] |
| 21.3 | Clicking an artifact in the menu opens the preview | [ ] |
| 21.4 | Uploading an additional document mid-session works (drag onto input bar or via + button) | [ ] |
| 21.5 | New document is immediately available to subsequent questions | [ ] |
| 21.6 | Upload zone / modal closes after a successful upload | [ ] |
| 21.7 | **Each document in the files menu has a trash icon visible on hover** (added in v2.2.0) | [ ] |
| 21.8 | Clicking the trash icon deletes the document : it disappears from the files menu and from the token counter's base | [ ] |
| 21.9 | Attempting to delete a document that's referenced by a past user message returns a 409 with a readable message : the chip on the past message still renders | [ ] |
| 21.10 | After document delete, the citation cache for that document is cleared : clicking an old citation that referenced one of its chunks shows a "not found" state, not a stale label | [ ] |

---

## 22. Citation integrity & hallucination defenses

These checks exercise the v2.3.1 hallucination hardening, the v2.3.3 retry-on-null, and today's post-2.3.3 hotfix for subagent interleaving.

| # | Item | P / F / NA |
|---|---|---|
| 22.1 | In the final recap, every citation resolves to a `[filename p.N]` label : no raw 36-char UUIDs leak into the final prose | [ ] |
| 22.2 | In the Thinking panel, fully-formed `[uuid]` tokens render as `[filename p.N]` pills | [ ] |
| 22.3 | When the Lead spawns ≥2 subagents in parallel, the Thinking panel does NOT show garbled UUID fragments interleaved with the prose (post-2.3.3 hotfix). Compare against: `todaf-421d-a53c-15`, `[107c814acb5334db81]`, `406c-9537-5d8bf6d768fc]` : none of these patterns should appear | [ ] |
| 22.4 | Each subagent's contribution to the Thinking panel is prefixed with `[<role>]` on its own line so concurrent runs are visually separated | [ ] |
| 22.5 | If a subagent returns a UUID that is not in the DB (hallucinated chunk ID), the Lead's tool result note includes a `WARNING: N hallucinated chunk ID(s) detected (...)` line : surfaced via `tool_use` content in the trace if you expand the row | [ ] |
| 22.6 | If a subagent returns no citations at all, the Lead's tool result note includes a `WARNING: no citations found : re-spawn this task` line | [ ] |
| 22.7 | The subagent system prompt (verifiable by logging or inspecting an `agent_spawned` event payload) lists `VALID CHUNK IDs FOR THIS TASK` : the vocabulary restriction is in place | [ ] |
| 22.8 | When a citation's chunk metadata fetch returns null **during streaming** (chunk not yet committed), the citation pill shows as `source` / raw UUID briefly, then **automatically re-fetches ~2s later** and updates to the proper `[filename p.N]` label without user action | [ ] |
| 22.9 | The retry on null does NOT fire repeatedly in a loop (only once per CitationLink instance) | [ ] |
| 22.10 | Searching a legal/regulatory document with a phrase like `Section 12(3)(a)` or `U.S.C. § 12` returns sensible FTS5 results : the dots, hyphens, slashes, and section signs survive tokenisation | [ ] |

---

## 23. Visual polish & accessibility

| # | Item | P / F / NA |
|---|---|---|
| 23.1 | All buttons have hover states (colour or background change) | [ ] |
| 23.2 | All interactive elements show a pointer cursor | [ ] |
| 23.3 | Focus outlines are visible when tabbing through elements | [ ] |
| 23.4 | Text contrast is readable (no grey-on-grey that's hard to read) | [ ] |
| 23.5 | Tooltips on icon buttons appear on hover (Copy, Edit, Retry, etc.) | [ ] |
| 23.6 | No element overflows its container at any viewport ≥1024px | [ ] |
| 23.7 | Scroll bars appear where needed (long messages, long trace panels) and don't double up | [ ] |
| 23.8 | No layout shift ("jumpy" content) during streaming : the artifact preview's deferred open prevents mid-stream reflow | [ ] |
| 23.9 | Font rendering is consistent (monospace only in code blocks and thinking panel) | [ ] |
| 23.10 | No obvious emoji or test strings left over from development | [ ] |
| 23.11 | The white-on-dark CTA palette is consistent across START, + New chat, audience toggle, and Send buttons | [ ] |
| 23.12 | The artifact card width is proportional to its title : short titles get small cards; long titles cap at ~24 rem | [ ] |

---

## 24. Cross-browser spot checks

Repeat sections 1, 6, 9, and 22 in at least two browsers.

| Browser | Splash loads | Start chat works | Final delivery flow works | Citation pills clean (no UUID fragments) |
|---|---|---|---|---|
| Chrome | [ ] | [ ] | [ ] | [ ] |
| Firefox | [ ] | [ ] | [ ] | [ ] |
| Edge / Safari | [ ] | [ ] | [ ] | [ ] |

---

## 25. Negative / adversarial scenarios

| # | Item | P / F / NA |
|---|---|---|
| 25.1 | Submit a message while already streaming : the Send button should be disabled; nothing queues up incorrectly | [ ] |
| 25.2 | Upload a 0-byte file : structured error, not a silent success | [ ] |
| 25.3 | Upload a 100MB+ file : either accepted with a progress indicator, or rejected with a size-limit error | [ ] |
| 25.4 | Send a message containing `[uuid-like-string]` that isn't a real chunk : citation link click does not crash the drawer | [ ] |
| 25.5 | Rapid-click the Send button 5 times : only one request is issued | [ ] |
| 25.6 | Rapid-click Retry 3 times : only one retry runs | [ ] |
| 25.7 | Rename a session to empty string : falls back to the original title or is rejected | [ ] |
| 25.8 | Rename a session to a 500-character string : truncates in the UI, persists correctly | [ ] |
| 25.9 | Delete the last session : sidebar shows empty state, app does not crash | [ ] |
| 25.10 | Paste a very large block (~50KB) of text into the input : counter updates, UI doesn't freeze | [ ] |
| 25.11 | Click Cancel during the **first few hundred ms** of a run (before any tool fires) : the cancellation still takes effect at the next iteration boundary | [ ] |
| 25.12 | Inject `<script>` or markdown link tricks into a user message : they render as plain text, not as executable HTML | [ ] |

---

## 26. Backend API sanity (optional : requires `curl` / Postman)

| # | Item | P / F / NA |
|---|---|---|
| 26.1 | `GET http://localhost:8000/sessions` returns a JSON list | [ ] |
| 26.2 | `GET http://localhost:8000/sessions/<id>` returns session detail with messages (each carrying `attached_document_ids` and `attached_documents`), documents, artifacts, and `last_run_state` | [ ] |
| 26.3 | `GET http://localhost:8000/sessions/<id>/trace` returns persisted trace events | [ ] |
| 26.4 | `GET http://localhost:8000/sessions/<id>/stream` holds open as SSE (inspect Network → EventStream) | [ ] |
| 26.5 | `GET http://localhost:8000/sessions/<id>/stream` on an idle session returns a synthetic `run_complete` and closes immediately | [ ] |
| 26.6 | `POST http://localhost:8000/sessions/<id>/cancel` on a running session returns `{ "cancelled": true }` and the run terminates within ~2s | [ ] |
| 26.7 | `POST http://localhost:8000/sessions/<id>/cancel` on an idle session returns `{ "cancelled": false }` (idempotent : no 4xx/5xx) | [ ] |
| 26.8 | `POST http://localhost:8000/sessions/<id>/count_tokens` accepts a body with `content` and optional `attached_document_ids` and returns `{ prompt_tokens, base_tokens, total_tokens, window, percent }` | [ ] |
| 26.9 | `GET http://localhost:8000/sessions/<id>/context` returns a value consistent with `count_tokens` (mirrors system + tools + doc index + history) | [ ] |
| 26.10 | `DELETE http://localhost:8000/sessions/<id>/documents/<doc_id>` removes an uploaded document; returns 409 if the document is referenced by a persisted message | [ ] |
| 26.11 | `GET http://localhost:8000/chunks/<id>` returns chunk metadata including `filename`, `page`, `section_id` | [ ] |
| 26.12 | Invalid session ID returns a 404 (not a 500) | [ ] |
| 26.13 | An SSE `error` event payload now carries `{ message, technical, code, status }` (not just `message`) | [ ] |

---

## 27. Conversation continuity (follow-up prompts) : NEW

These checks exercise the v2.3.3 conversation-history grounding and artifact catalogue. Run them **after** a successful first turn that produced an artifact.

| # | Item | P / F / NA |
|---|---|---|
| 27.1 | Sending a follow-up like "extend point 3" / "expand on the second section" : the Lead references the prior recap content, not "I don't see any prior context" | [ ] |
| 27.2 | Sending "convert that to CSV" : the Lead acknowledges the prior artifact by name and writes a new CSV artifact derived from it, not a hallucinated empty CSV | [ ] |
| 27.3 | The follow-up reply does **not** claim "no artifact exists in this session" when one was produced earlier in the same session | [ ] |
| 27.4 | Citations in the follow-up reply reuse the same chunk IDs that grounded the original recap (not freshly hallucinated UUIDs) : no `WARNING: hallucinated chunk ID(s)` notes in the trace | [ ] |
| 27.5 | The Lead's context meter reflects the cumulative history including the prior turn : the meter grows on the second turn rather than resetting | [ ] |
| 27.6 | After 3+ follow-up turns, the conversation remains coherent (the model still refers to the original document and prior artifacts correctly) | [ ] |

---

## Issue Log

> Log every **F** from above here. Use the same numbering (e.g. "9.8").
> The goal is that a single round of fixes resolves everything in this list.

| # | Section/Item | What you saw | What you expected | Reproduction steps | Severity (blocker / major / minor / cosmetic) | Screenshot / video path |
| - | ------------ | ------------ | ----------------- | ------------------ | --------------------------------------------- | ----------------------- |
|   |              |              |                   |                    |                                               |                         |
|   |              |              |                   |                    |                                               |                         |
|   |              |              |                   |                    |                                               |                         |

---

## Free-form observations

> Anything that didn't fit the checklist : UX friction, unclear labels, surprising behaviour, performance impressions, copy suggestions.

-
-
-

---

## Sign-off

- [ ] All critical items (Sections 9, 10, 15, 18, 19, 20, 22, 27) pass
- [ ] Issue Log is complete for every **F** above
- [ ] Screenshots / recordings attached for visual bugs

**Tester signature:** _______________
**Date completed:** _______________
