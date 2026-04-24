# Constellation — UAT Checklist

**Version under test:** 2.1
**Tester:** _______________
**Date:** _______________
**Environment:** [ ] Local dev  [ ] Staging  [ ] Production
**Backend model (`ANTHROPIC_MODEL`):** _______________
**Browser / OS:** _______________

---

## How to use this document

1. Work through sections in order. Sections later in the doc assume you've completed the earlier ones (e.g. session-page checks assume a session exists).
2. For each checklist item, mark one of:
   - **P** = Pass (behaved as described)
   - **F** = Fail (did not behave as described — log in the Issue Log)
   - **N/A** = Not applicable / couldn't test (note why in the Issue Log)
3. Every **F** gets a row in the **Issue Log** at the bottom. Include the section + item number, what you saw, what you expected, and (if possible) reproduction steps + screenshot/video path.
4. Submit this completed file back in one go so all issues can be addressed in a single pass.

---

## Pre-flight

- [ ] Backend running on `http://localhost:8000` (`uvicorn backend.app:app --reload --port 8000`)
- [ ] Frontend running on `http://localhost:3000` (`npm run dev` in `frontend/`)
- [ ] `ANTHROPIC_API_KEY` is set in the backend environment
- [ ] `deep_reading.db` file exists after first backend start
- [ ] Browser DevTools Console open — note any red errors throughout (put them in the Issue Log)
- [ ] Browser DevTools Network tab open — watch for failed requests (red rows)

**Test documents to prepare (place in a `uat/fixtures/` folder):**
- [ ] A small PDF (~5 pages) — e.g. the Condensed Wealth of Nations you used before
- [ ] A medium PDF (~30–50 pages)
- [ ] A large PDF (~150+ pages) — to stress the chunker + context meter
- [ ] A `.docx` file
- [ ] A `.txt` file
- [ ] A `.md` file
- [ ] An `.html` file
- [ ] An **unsupported** file (e.g. `.xlsx` or `.png`) — for negative testing
- [ ] A **corrupt** file (rename a random binary to `.pdf`) — for negative testing
- [ ] A file with a **very long name** (>80 chars before the extension)
- [ ] A file with **non-ASCII characters** in the name (e.g. `Réglementation_française.pdf`)

---

## 1. Splash page (`/`)

| # | Item | P / F / N/A |
|---|---|---|
| 1.1 | Splash page loads at `http://localhost:3000/` within 2s | |
| 1.2 | "Constellation" title is visible and readable over the background | |
| 1.3 | Subtitle paragraph is visible and readable | |
| 1.4 | Background image is visible (not black / not broken image) | |
| 1.5 | Background crossfades to a new image roughly every 6 seconds | |
| 1.6 | Crossfade is smooth (no flash of black / no jump cut) | |
| 1.7 | All 6 slide images load without broken-image icons (check DevTools → Network) | |
| 1.8 | **START** button is visible, centred, and large | |
| 1.9 | Clicking **START** navigates to `/home` | |
| 1.10 | Resizing the browser (narrow → wide) keeps the layout intact | |
| 1.11 | Page works on a ≥1280px wide window | |
| 1.12 | Page works on a narrow (~768px, tablet-size) window | |
| 1.13 | Page works on a phone-width (~375px) window | |

---

## 2. Home page (`/home`) — empty state

| # | Item | P / F / N/A |
|---|---|---|
| 2.1 | Greeting matches time of day ("Good morning" / "Good afternoon" / "Good evening" / "Still up" if before 5am) | |
| 2.2 | Subtitle "Ask a question or upload a document to begin." is visible | |
| 2.3 | Prompt bar is visible below the greeting (roughly 30% down the viewport) | |
| 2.4 | Audience toggle at the top shows 3 options: **Layperson / Professional / Expert** | |
| 2.5 | **Professional** is selected by default | |
| 2.6 | Clicking each audience option visibly highlights the chosen one | |
| 2.7 | Token counter displays `0 tokens` (or similar) when the input is empty | |
| 2.8 | Typing in the input — token counter updates within ~500ms after you stop typing | |
| 2.9 | Token count is roughly `prompt length / 4` before any upload (e.g. 100 chars ≈ 25 tokens) | |
| 2.10 | Left sidebar is visible and empty (no chats yet) — or shows prior sessions if the DB isn't fresh | |
| 2.11 | **+** button next to the input opens a popover with "Upload files" | |
| 2.12 | Clicking outside the popover closes it | |
| 2.13 | Pressing **Enter** on an empty input does nothing (does not submit) | |
| 2.14 | Pressing **Shift+Enter** on the input inserts a newline | |

---

## 3. Home page — file upload (click)

| # | Item | P / F / N/A |
|---|---|---|
| 3.1 | Clicking + → "Upload files" opens the OS file picker | |
| 3.2 | Uploading a small PDF — "Ingesting…" spinner appears | |
| 3.3 | After ingest, a chip with the filename + 📄 icon appears above the input | |
| 3.4 | "1 ready" indicator with a green checkmark appears | |
| 3.5 | Token counter updates to reflect the ingested document tokens (should jump substantially) | |
| 3.6 | Uploading a second file — a second chip appears | |
| 3.7 | Clicking the **×** on a chip removes that file from the pending list | |
| 3.8 | Filename in the chip is truncated if long (with full name on hover) | |
| 3.9 | A draft session appears in the left sidebar once the first upload succeeds | |

---

## 4. Home page — drag-and-drop upload

| # | Item | P / F / N/A |
|---|---|---|
| 4.1 | Dragging a file over the home page shows a blue dashed overlay with "Drop files to upload" | |
| 4.2 | Dragging the file out of the window removes the overlay | |
| 4.3 | Dropping the file uploads it (chip appears, token count updates) | |
| 4.4 | Dropping multiple files at once uploads them sequentially (all chips appear) | |

---

## 5. Home page — file format coverage

Upload each file type. Confirm it produces a chip **or** surfaces a readable error.

| # | File type | Result (chip ✓ / error message text) |
|---|---|---|
| 5.1 | `.pdf` (valid, small) | |
| 5.2 | `.docx` | |
| 5.3 | `.txt` | |
| 5.4 | `.md` | |
| 5.5 | `.html` | |
| 5.6 | `.xlsx` or another unsupported type — should show a red error message | |
| 5.7 | Corrupt `.pdf` (random bytes renamed) — should show a red error, not silently succeed | |
| 5.8 | File with non-ASCII filename — chip displays the filename correctly | |
| 5.9 | File with very long filename — chip truncates with ellipsis; full name on hover | |
| 5.10 | Uploading a large PDF (~150 pages) — ingest completes in a reasonable time (note the duration: ___ s) | |

---

## 6. Home page — start chat

| # | Item | P / F / N/A |
|---|---|---|
| 6.1 | With input filled + file attached, the **Send** (↑ or ➤) button is enabled | |
| 6.2 | With empty input + no file, the Send button is disabled | |
| 6.3 | With empty input + file attached, Send is enabled (file-only submission allowed) | |
| 6.4 | Clicking Send navigates to `/sessions/<id>` | |
| 6.5 | The URL carries `?prompt=...&audience=...` on first submit | |
| 6.6 | Pressing **Enter** (without Shift) submits the same as clicking Send | |

---

## 7. Session page — initial load after handoff

| # | Item | P / F / N/A |
|---|---|---|
| 7.1 | Session page loads without a full page flash (no white flash) | |
| 7.2 | URL query string (`?prompt=...`) is cleared after initial load | |
| 7.3 | The user's submitted prompt appears as a user bubble (right-aligned, blue) | |
| 7.4 | Attached document chips appear inside the user bubble | |
| 7.5 | A "Thinking…" panel appears below with a pulsing live indicator | |
| 7.6 | Status text shows something like "Agents are starting up…" initially | |
| 7.7 | Within ~5–10 seconds, the thinking panel shows agent activity | |
| 7.8 | Agent Trace panel (bottom of chat) populates with `agent_spawned` / `tool_use` rows | |
| 7.9 | The audience toggle in the header reflects the audience from the URL | |

---

## 8. Session page — active streaming run

While the agents are working (before `finalize`):

| # | Item | P / F / N/A |
|---|---|---|
| 8.1 | Thinking panel streams new text as agents progress (text grows over time) | |
| 8.2 | Thinking panel auto-scrolls as new content arrives | |
| 8.3 | Thinking panel's **Hide / Show** toggle works | |
| 8.4 | Agent Trace panel shows `agent_spawned: lead_orchestrator` as the first entry | |
| 8.5 | Subsequent `tool_use` rows show tool names (`read_document_chunk`, `search_document`, etc.) | |
| 8.6 | When `spawn_subagent` is called, a new `agent_spawned` entry appears for each subagent | |
| 8.7 | When `write_artifact` is called, a `tool_use: write_artifact` entry appears | |
| 8.8 | Context Meter bar at the bottom of the input area updates over time | |
| 8.9 | Context Meter percentage is never above 100% (cap is respected) | |
| 8.10 | The **Send** button is replaced with a red **Stop** (■) button while streaming | |
| 8.11 | Typing in the input is disabled while streaming (input is greyed out) | |

---

## 9. Session page — final output delivery (CRITICAL)

These checks cover the bugs fixed in the last round — verify the new flow works end-to-end.

| # | Item | P / F / N/A |
|---|---|---|
| 9.1 | When the Lead calls `finalize`, the final message begins typing in letter-by-letter (typewriter animation) | |
| 9.2 | The typewriter speed feels natural — not instant, not sluggish (should take ~8–12s for a ~500-word recap) | |
| 9.3 | A blinking cursor ▋ appears at the end of the text while it's typing | |
| 9.4 | The thinking panel collapses (or its content clears) when the final message starts streaming — no duplication of the recap inside "Thinking…" | |
| 9.5 | If an artifact was produced this turn, a **"Generated files"** section with a file button appears below the streaming text (while it's still typing, or just after) | |
| 9.6 | The file button shows the artifact name (e.g. "Adam Smith's Wealth of Nations: Key Concepts Summary") | |
| 9.7 | Clicking the file button opens the **Artifact Preview** canvas on the right side of the window | |
| 9.8 | About ~1s after the recap text starts streaming, the Artifact Preview **auto-opens** on the right (if an artifact was produced) | |
| 9.9 | The Artifact Preview does NOT pop open mid-stream in a jarring way (it should feel deliberate, after text has begun) | |
| 9.10 | The chat column shrinks to make room for the preview (no overlap) | |
| 9.11 | After streaming finishes, the blinking cursor disappears | |
| 9.12 | The assistant bubble now shows a **Copy** and **Retry** action row | |
| 9.13 | No red console errors during the `final_message` / `run_complete` transition | |
| 9.14 | `TypeError: Cannot read properties of null` does NOT appear anywhere in the console | |

---

## 10. Artifact Preview canvas

| # | Item | P / F / N/A |
|---|---|---|
| 10.1 | Preview canvas slides in from the right (not a jump-cut) | |
| 10.2 | Preview renders Markdown artifacts as formatted HTML (headings, bullets, tables) | |
| 10.3 | HTML artifacts render with styles applied | |
| 10.4 | CSV artifacts render as a table | |
| 10.5 | Citations inside the artifact (`[uuid]`) are clickable | |
| 10.6 | Clicking a citation in the artifact opens the **Source Drawer** on the right (or overlays) with the chunk contents | |
| 10.7 | Clicking the × button on the preview closes it and returns the chat column to full width | |
| 10.8 | If there's a download link/button, it downloads the raw artifact | |
| 10.9 | Opening an artifact, closing it, and reopening it from the session files menu works repeatedly without glitches | |

---

## 11. Inline citations in the recap

| # | Item | P / F / N/A |
|---|---|---|
| 11.1 | Citations in the assistant message appear as `[uuid]` or as a pill/link | |
| 11.2 | Hovering a citation changes the cursor to a pointer | |
| 11.3 | Clicking a citation opens the **Source Drawer** with the referenced chunk | |
| 11.4 | Source Drawer shows: chunk text, section (if any), page (if any), filename | |
| 11.5 | Closing the drawer (× or click outside) works | |
| 11.6 | Multi-citation blocks `[uuid, uuid]` show each citation as a separate clickable element | |

---

## 12. Agent Trace panel

| # | Item | P / F / N/A |
|---|---|---|
| 12.1 | Trace panel is collapsible (click header to expand/collapse) | |
| 12.2 | Trace entries show a timestamp and an icon per event type | |
| 12.3 | `agent_spawned` rows show the agent's role | |
| 12.4 | `tool_use` rows show the tool name and expandable input JSON | |
| 12.5 | `artifact_written` rows show the artifact name | |
| 12.6 | `agent_done` rows show a summary | |
| 12.7 | `compaction_done` rows show before/after token counts | |
| 12.8 | Trace survives a browser refresh (reload the page — events reappear) | |
| 12.9 | Trace survives switching to another session and back (no duplication) | |

---

## 13. Chat sidebar

| # | Item | P / F / N/A |
|---|---|---|
| 13.1 | Sidebar lists all sessions, most recent first | |
| 13.2 | Active session is highlighted | |
| 13.3 | Clicking a different session navigates to it without a full page flash | |
| 13.4 | Session titles auto-generate from the first user message after first send | |
| 13.5 | Pin button on a session row moves it to a pinned group (top) | |
| 13.6 | Unpinning moves it back to the regular list | |
| 13.7 | Rename via pencil icon lets you edit the title inline | |
| 13.8 | Rename persists after page refresh | |
| 13.9 | Delete button prompts for confirmation (or uses a destructive style) | |
| 13.10 | Deleting a session removes it from the list and navigates away if it was active | |
| 13.11 | Deleting a session does NOT leave an orphaned route (no 404 on the now-dead URL) | |

---

## 14. Audience toggle

Test all three levels on the same document + same question to confirm the output differs.

| # | Item | P / F / N/A |
|---|---|---|
| 14.1 | Switching audience persists across reload (session detail endpoint saves it) | |
| 14.2 | **Layperson** mode produces plainer language, no jargon | |
| 14.3 | **Professional** mode produces standard business/technical language | |
| 14.4 | **Expert** mode produces technical / precise / domain-specific language | |
| 14.5 | Typing "explain in layman's terms" while Professional is selected auto-switches to Layperson | |
| 14.6 | Typing "give me the expert analysis" auto-switches to Expert | |
| 14.7 | Casual language like "simple question" does NOT falsely trigger an audience switch | |

---

## 15. Retry & Edit

| # | Item | P / F / N/A |
|---|---|---|
| 15.1 | Only the **last** assistant message shows a Retry button | |
| 15.2 | Clicking Retry removes the current assistant reply and re-runs the user prompt | |
| 15.3 | After retry, a new recap + new artifact (if applicable) appears in the same slot | |
| 15.4 | Every user message has an **Edit** (pencil) button | |
| 15.5 | Clicking Edit turns the bubble into a textarea with Save/Cancel | |
| 15.6 | The edit textarea retains the bubble's width (doesn't collapse) | |
| 15.7 | Saving an edit truncates all messages after it and re-runs | |
| 15.8 | Cancelling an edit restores the original bubble | |
| 15.9 | Editing a middle-of-conversation message wipes subsequent turns (not just the next one) | |
| 15.10 | Attached-doc chips on an edited message are preserved | |

---

## 16. Context meter & compaction

| # | Item | P / F / N/A |
|---|---|---|
| 16.1 | Context meter shows a percentage and a filled bar | |
| 16.2 | Meter updates as the run progresses | |
| 16.3 | Clicking **Compact** manually triggers compaction | |
| 16.4 | During compaction, the button shows a loading state | |
| 16.5 | After compaction, the meter drops to a lower percentage | |
| 16.6 | A `compaction_done` entry appears in the Agent Trace | |
| 16.7 | On a very long conversation (simulate by sending 10+ messages), auto-compaction fires at ~85% (note the actual trigger: ___%) | |
| 16.8 | After auto-compaction, the conversation still renders correctly (no missing messages) | |

---

## 17. In-session search

| # | Item | P / F / N/A |
|---|---|---|
| 17.1 | Clicking the search icon in the input bar reveals a search field | |
| 17.2 | Typing a query highlights matches in the messages (amber/yellow highlight) | |
| 17.3 | The counter shows `1 / N` where N is the total match count | |
| 17.4 | **Enter** jumps to the next match and scrolls it into view | |
| 17.5 | **Shift+Enter** jumps to the previous match | |
| 17.6 | The current match is styled differently from other matches (more vivid highlight) | |
| 17.7 | Esc closes the search and clears the query | |
| 17.8 | Search works on both user and assistant messages | |
| 17.9 | Search does NOT match inside citation UUIDs (or if it does, it's intentional) | |
| 17.10 | Clearing the query removes all highlights | |

---

## 18. Stop & error handling

| # | Item | P / F / N/A |
|---|---|---|
| 18.1 | Clicking **Stop** during streaming halts the run within ~2s | |
| 18.2 | A "[stopped]" indicator appears on the partial reply | |
| 18.3 | After stop, input is re-enabled | |
| 18.4 | Killing the backend mid-stream surfaces a readable error (not a silent hang) | |
| 18.5 | Disconnecting WiFi mid-stream — UI recovers gracefully after reconnect | |
| 18.6 | Sending a message with no document uploaded still works (or shows a helpful empty-state) | |
| 18.7 | Sending a nonsensical prompt ("asdfghjkl") still returns a reply without crashing | |

---

## 19. Persistence across reloads

After a full run completes, refresh the browser (Ctrl/Cmd+R):

| # | Item | P / F / N/A |
|---|---|---|
| 19.1 | The user + assistant messages all reappear in order | |
| 19.2 | Inline citations still clickable after reload | |
| 19.3 | Generated artifact buttons still visible under the right assistant message | |
| 19.4 | Clicking an artifact button after reload opens the preview canvas | |
| 19.5 | Agent trace events reappear (persisted trace) | |
| 19.6 | Context meter shows a seeded value (not stuck at 0) | |
| 19.7 | Audience toggle matches what was set before reload | |
| 19.8 | Session title matches (no reset to default) | |
| 19.9 | Thinking panel for past turns is collapsible but collapsed by default | |

---

## 20. Multi-session behaviour

| # | Item | P / F / N/A |
|---|---|---|
| 20.1 | Open session A, start a run, switch to session B mid-stream — B shows its own history, A's stream continues in the background (or reattaches when you return) | |
| 20.2 | Returning to A shows the completed run (no duplicated messages) | |
| 20.3 | Starting a run in A then immediately in B — both complete and are stored under the right session | |
| 20.4 | Uploading a file in A does not appear in B's session files | |
| 20.5 | Deleting A while B is streaming does not affect B | |

---

## 21. File management within a session

| # | Item | P / F / N/A |
|---|---|---|
| 21.1 | Session header's "files" menu lists all attached documents | |
| 21.2 | Session header's files menu lists all generated artifacts | |
| 21.3 | Clicking an artifact in the menu opens the preview | |
| 21.4 | Uploading an additional document mid-session works (drag onto input bar or via + button) | |
| 21.5 | New document is immediately available to subsequent questions | |
| 21.6 | Upload zone / modal closes after a successful upload | |

---

## 22. Visual polish & accessibility

| # | Item | P / F / N/A |
|---|---|---|
| 22.1 | All buttons have hover states (colour or background change) | |
| 22.2 | All interactive elements show a pointer cursor | |
| 22.3 | Focus outlines are visible when tabbing through elements | |
| 22.4 | Text contrast is readable (no grey-on-grey that's hard to read) | |
| 22.5 | Tooltips on icon buttons appear on hover (Copy, Edit, Retry, etc.) | |
| 22.6 | No element overflows its container at any viewport ≥1024px | |
| 22.7 | Scroll bars appear where needed (long messages, long trace panels) and don't double up | |
| 22.8 | No layout shift ("jumpy" content) during streaming | |
| 22.9 | Font rendering is consistent (monospace only in code blocks and thinking panel) | |
| 22.10 | No obvious emoji or test strings left over from development | |

---

## 23. Cross-browser spot checks

Repeat sections 1, 6, and 9 in at least two browsers.

| Browser | Splash loads | Start chat works | Final delivery flow works |
|---|---|---|---|
| Chrome | | | |
| Firefox | | | |
| Edge / Safari | | | |

---

## 24. Negative / adversarial scenarios

| # | Item | P / F / N/A |
|---|---|---|
| 24.1 | Submit a message while already streaming — the Send button should be disabled; nothing queues up incorrectly | |
| 24.2 | Upload a 0-byte file — readable error, not a silent success | |
| 24.3 | Upload a 100MB+ file — either accepted with a progress indicator, or rejected with a size-limit error | |
| 24.4 | Send a message containing `[uuid-like-string]` that isn't a real chunk — citation link click does not crash the drawer | |
| 24.5 | Rapid-click the Send button 5 times — only one request is issued | |
| 24.6 | Rapid-click Retry 3 times — only one retry runs | |
| 24.7 | Rename a session to empty string — falls back to the original title or is rejected | |
| 24.8 | Rename a session to a 500-character string — truncates in the UI, persists correctly | |
| 24.9 | Delete the last session — sidebar shows empty state, app does not crash | |
| 24.10 | Paste a very large block (~50KB) of text into the input — counter updates, UI doesn't freeze | |

---

## 25. Backend API sanity (optional — requires `curl` / Postman)

| # | Item | P / F / N/A |
|---|---|---|
| 25.1 | `GET http://localhost:8000/sessions` returns a JSON list | |
| 25.2 | `GET http://localhost:8000/sessions/<id>` returns session detail with messages, documents, artifacts | |
| 25.3 | `GET http://localhost:8000/sessions/<id>/trace` returns persisted trace events | |
| 25.4 | `GET http://localhost:8000/sessions/<id>/stream` holds open as SSE (inspect Network → EventStream) | |
| 25.5 | Invalid session ID returns a 404 (not a 500) | |

---

## Issue Log

> Log every **F** from above here. Use the same numbering (e.g. "9.8").
> The goal is that a single round of fixes resolves everything in this list.

| # | Section/Item | What you saw | What you expected | Reproduction steps | Severity (blocker / major / minor / cosmetic) | Screenshot / video path |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

---

## Free-form observations

> Anything that didn't fit the checklist — UX friction, unclear labels, surprising behaviour, performance impressions, copy suggestions.

-
-
-
-

---

## Sign-off

- [ ] All critical items (Sections 9, 10, 15, 18, 19) pass
- [ ] Issue Log is complete for every **F** above
- [ ] Screenshots / recordings attached for visual bugs

**Tester signature:** _______________
**Date completed:** _______________
