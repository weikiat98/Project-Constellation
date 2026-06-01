# Constellation : UAT Checklist

**Version under test:** 2.1
**Tester:** _______________
**Date:** _______25 April 2025________
**Environment:** [Y] Local dev  [ ] Staging  [ ] Production
**Backend model (`ANTHROPIC_MODEL`):** _______________
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

---

## Pre-flight

- [P] Backend running on `http://localhost:8000` (`uvicorn backend.app:app --reload --port 8000`)
- [P] Frontend running on `http://localhost:3000` (`npm run dev` in `frontend/`)
- [P] `ANTHROPIC_API_KEY` is set in the backend environment
- [P] `deep_reading.db` file exists after first backend start
- [P] Browser DevTools Console open : note any red errors throughout (put them in the Issue Log)
- [P] Browser DevTools Network tab open : watch for failed requests (red rows)

**Test documents to prepare (place in a `uat/fixtures/` folder):**
- [P] A small PDF (~5 pages) : e.g. the Condensed Wealth of Nations you used before
- [P] A medium PDF (~30–50 pages)
- [P] A large PDF (~150+ pages) : to stress the chunker + context meter
- [P] A `.docx` file
- [P] A `.txt` file
- [P] A `.md` file
- [P] An `.html` file
- [P] An **unsupported** file (e.g. `.xlsx` or `.png`) : for negative testing
- [NA] A **corrupt** file (rename a random binary to `.pdf`) : for negative testing
- [NA] A file with a **very long name** (>80 chars before the extension)
- [NA] A file with **non-ASCII characters** in the name (e.g. `Réglementation_française.pdf`)

---

## 1. Splash page (`/`)

| # | Item | P / F / N/A |
|---|---|---|
| 1.1 | Splash page loads at `http://localhost:3000/` within 2s | [P] | 
| 1.2 | "Constellation" title is visible and readable over the background | [P] |
| 1.3 | Subtitle paragraph is visible and readable | [P] |
| 1.4 | Background image is visible (not black / not broken image) | [P] |
| 1.5 | Background crossfades to a new image roughly every 6 seconds | [P] |
| 1.6 | Crossfade is smooth (no flash of black / no jump cut) | [P] |
| 1.7 | All 6 slide images load without broken-image icons (check DevTools → Network) | [P] |
| 1.8 | **START** button is visible, centred, and large | [P] |
| 1.9 | Clicking **START** navigates to `/home` | [P] |
| 1.10 | Resizing the browser (narrow → wide) keeps the layout intact | [P] |
| 1.11 | Page works on a ≥1280px wide window | [P] |
| 1.12 | Page works on a narrow (~768px, tablet-size) window | [P] |
| 1.13 | Page works on a phone-width (~375px) window | [NA] |

---

## 2. Home page (`/home`) : empty state

| # | Item | P / F / N/A |
|---|---|---|
| 2.1 | Greeting matches time of day ("Good morning" / "Good afternoon" / "Good evening" / "Still up" if before 5am) | [P] |
| 2.2 | Subtitle "Ask a question or upload a document to begin." is visible | [P] |
| 2.3 | Prompt bar is visible below the greeting (roughly 30% down the viewport) | [P] |
| 2.4 | Audience toggle at the top shows 3 options: **Layperson / Professional / Expert** | [P] |
| 2.5 | **Professional** is selected by default | [P] |
| 2.6 | Clicking each audience option visibly highlights the chosen one | [P] |
| 2.7 | Token counter displays `0 tokens` (or similar) when the input is empty | [P] |
| 2.8 | Typing in the input : token counter updates within ~500ms after you stop typing | [P] |
| 2.9 | Token count is roughly `prompt length / 4` before any upload (e.g. 100 chars ≈ 25 tokens) | [P] |
| 2.10 | Left sidebar is visible and empty (no chats yet) : or shows prior sessions if the DB isn't fresh | [P] |
| 2.11 | **+** button next to the input opens a popover with "Upload files" | [P] |
| 2.12 | Clicking outside the popover closes it | [P] |
| 2.13 | Pressing **Enter** on an empty input does nothing (does not submit) | [P] |
| 2.14 | Pressing **Shift+Enter** on the input inserts a newline | [P] |

---

## 3. Home page : file upload (click)

| # | Item | P / F / N/A |
|---|---|---|
| 3.1 | Clicking + → "Upload files" opens the OS file picker | [P] |
| 3.2 | Uploading a small PDF : "Ingesting…" spinner appears | [P] |
| 3.3 | After ingest, a chip with the filename + 📄 icon appears above the input | [P] |
| 3.4 | "1 ready" indicator with a green checkmark appears | [P] |
| 3.5 | Token counter updates to reflect the ingested document tokens (should jump substantially) | [P] |
| 3.6 | Uploading a second file : a second chip appears | [P] |
| 3.7 | Clicking the **×** on a chip removes that file from the pending list | [P] |
| 3.8 | Filename in the chip is truncated if long (with full name on hover) | [P] |
| 3.9 | A draft session appears in the left sidebar once the first upload succeeds | [P] |

---

## 4. Home page : drag-and-drop upload

| # | Item | P / F / N/A |
|---|---|---|
| 4.1 | Dragging a file over the home page shows a blue dashed overlay with "Drop files to upload" | [P] |
| 4.2 | Dragging the file out of the window removes the overlay | [P] |
| 4.3 | Dropping the file uploads it (chip appears, token count updates) | [P] |
| 4.4 | Dropping multiple files at once uploads them sequentially (all chips appear) | [P] |

---

## 5. Home page : file format coverage

Upload each file type. Confirm it produces a chip **or** surfaces a readable error.

| # | File type | Result (chip ✓ / error message text) |
|---|---|---|
| 5.1 | `.pdf` (valid, small) | [✓] |
| 5.2 | `.docx` | [✓] |
| 5.3 | `.txt` | [✓] |
| 5.4 | `.md` | [✓] |
| 5.5 | `.html` | [✓] |
| 5.6 | `.xlsx` or another unsupported type : should show a red error message | [✓] |
| 5.7 | Corrupt `.pdf` (random bytes renamed) : should show a red error, not silently succeed | [NA] |
| 5.8 | File with non-ASCII filename : chip displays the filename correctly | [NA] |
| 5.9 | File with very long filename : chip truncates with ellipsis; full name on hover | [NA] |
| 5.10 | Uploading a large PDF (~150 pages) : ingest completes in a reasonable time (note the duration: ___ s) | [✓] |

---

## 6. Home page : start chat

| # | Item | P / F / N/A |
|---|---|---|
| 6.1 | With input filled + file attached, the **Send** (↑ or ➤) button is enabled | [P] |
| 6.2 | With empty input + no file, the Send button is disabled | [P] |
| 6.3 | With empty input + file attached, Send is enabled (file-only submission allowed) | [P] |
| 6.4 | Clicking Send navigates to `/sessions/<id>` | [P] |
| 6.5 | The URL carries `?prompt=...&audience=...` on first submit | [NA] |
| 6.6 | Pressing **Enter** (without Shift) submits the same as clicking Send | [P] |

---

## 7. Session page : initial load after handoff

| # | Item | P / F / N/A |
|---|---|---|
| 7.1 | Session page loads without a full page flash (no white flash) | [P] |
| 7.2 | URL query string (`?prompt=...`) is cleared after initial load | [NA] |
| 7.3 | The user's submitted prompt appears as a user bubble (right-aligned, blue) | [P] |
| 7.4 | Attached document chips appear inside the user bubble | [F] |
| 7.5 | A "Thinking…" panel appears below with a pulsing live indicator | [P] |
| 7.6 | Status text shows something like "Agents are starting up…" initially | [P] |
| 7.7 | Within ~5–10 seconds, the thinking panel shows agent activity | [P] |
| 7.8 | Agent Trace panel (bottom of chat) populates with `agent_spawned` / `tool_use` rows | [P] |
| 7.9 | The audience toggle in the header reflects the audience from the URL | [NA] |

---

## 8. Session page : active streaming run

While the agents are working (before `finalize`):

| # | Item | P / F / N/A |
|---|---|---|
| 8.1 | Thinking panel streams new text as agents progress (text grows over time) | [P] |
| 8.2 | Thinking panel auto-scrolls as new content arrives | [NA] |
| 8.3 | Thinking panel's **Hide / Show** toggle works | [P] |
| 8.4 | Agent Trace panel shows `agent_spawned: lead_orchestrator` as the first entry | [P] |
| 8.5 | Subsequent `tool_use` rows show tool names (`read_document_chunk`, `search_document`, etc.) | [P] |
| 8.6 | When `spawn_subagent` is called, a new `agent_spawned` entry appears for each subagent | [P] |
| 8.7 | When `write_artifact` is called, a `tool_use: write_artifact` entry appears | [P] |
| 8.8 | Context Meter bar at the bottom of the input area updates over time | [P] |
| 8.9 | Context Meter percentage is never above 100% (cap is respected) | [NA] |
| 8.10 | The **Send** button is replaced with a red **Stop** (■) button while streaming | [P] |
| 8.11 | Typing in the input is disabled while streaming (input is greyed out) | [P] |

---

## 9. Session page : final output delivery (CRITICAL)

These checks cover the bugs fixed in the last round : verify the new flow works end-to-end.

| # | Item | P / F / N/A |
|---|---|---|
| 9.1 | When the Lead calls `finalize`, the final message begins typing in letter-by-letter (typewriter animation) | [F] |
| 9.2 | The typewriter speed feels natural : not instant, not sluggish (should take ~8–12s for a ~500-word recap) | [F] |
| 9.3 | A blinking cursor ▋ appears at the end of the text while it's typing | [F] |
| 9.4 | The thinking panel collapses (or its content clears) when the final message starts streaming : no duplication of the recap inside "Thinking…" | [P] |
| 9.5 | If an artifact was produced this turn, a **"Generated files"** section with a file button appears below the streaming text (while it's still typing, or just after) | [P] |
| 9.6 | The file button shows the artifact name (e.g. "Adam Smith's Wealth of Nations: Key Concepts Summary") | [P] |
| 9.7 | Clicking the file button opens the **Artifact Preview** canvas on the right side of the window | [P] |
| 9.8 | About ~1s after the recap text starts streaming, the Artifact Preview **auto-opens** on the right (if an artifact was produced) | [P] |
| 9.9 | The Artifact Preview does NOT pop open mid-stream in a jarring way (it should feel deliberate, after text has begun) | [P] |
| 9.10 | The chat column shrinks to make room for the preview (no overlap) | [P] |
| 9.11 | After streaming finishes, the blinking cursor disappears | [F] |
| 9.12 | The assistant bubble now shows a **Copy** and **Retry** action row | [P] |
| 9.13 | No red console errors during the `final_message` / `run_complete` transition | [P] |
| 9.14 | `TypeError: Cannot read properties of null` does NOT appear anywhere in the console | [P] |

---

## 10. Artifact Preview canvas

| # | Item | P / F / N/A |
|---|---|---|
| 10.1 | Preview canvas slides in from the right (not a jump-cut) | [P] |
| 10.2 | Preview renders Markdown artifacts as formatted HTML (headings, bullets, tables) | [P] |
| 10.3 | HTML artifacts render with styles applied | [P] |
| 10.4 | CSV artifacts render as a table | [NA] |
| 10.5 | Citations inside the artifact (`[uuid]`) are clickable | [P] |
| 10.6 | Clicking a citation in the artifact opens the **Source Drawer** on the right (or overlays) with the chunk contents | [P] |
| 10.7 | Clicking the × button on the preview closes it and returns the chat column to full width | [P] |
| 10.8 | If there's a download link/button, it downloads the raw artifact | [P] |
| 10.9 | Opening an artifact, closing it, and reopening it from the session files menu works repeatedly without glitches | [P] |

---

## 11. Inline citations in the recap

| # | Item | P / F / N/A |
|---|---|---|
| 11.1 | Citations in the assistant message appear as `[uuid]` or as a pill/link | [P] |
| 11.2 | Hovering a citation changes the cursor to a pointer | [P] |
| 11.3 | Clicking a citation opens the **Source Drawer** with the referenced chunk | [P] |
| 11.4 | Source Drawer shows: chunk text, section (if any), page (if any), filename | [P] |
| 11.5 | Closing the drawer (× or click outside) works | [P] |
| 11.6 | Multi-citation blocks `[uuid, uuid]` show each citation as a separate clickable element | [P] |

---

## 12. Agent Trace panel

| # | Item | P / F / N/A |
|---|---|---|
| 12.1 | Trace panel is collapsible (click header to expand/collapse) | [P] |
| 12.2 | Trace entries show a timestamp and an icon per event type | [P] |
| 12.3 | `agent_spawned` rows show the agent's role | [P] |
| 12.4 | `tool_use` rows show the tool name and expandable input JSON | [P] |
| 12.5 | `artifact_written` rows show the artifact name | [P] |
| 12.6 | `agent_done` rows show a summary | [F] |
| 12.7 | `compaction_done` rows show before/after token counts | [NA] |
| 12.8 | Trace survives a browser refresh (reload the page : events reappear) | [P] |
| 12.9 | Trace survives switching to another session and back (no duplication) | [P] |

---

## 13. Chat sidebar

| # | Item | P / F / N/A |
|---|---|---|
| 13.1 | Sidebar lists all sessions, most recent first | [P] |
| 13.2 | Active session is highlighted | [P] |
| 13.3 | Clicking a different session navigates to it without a full page flash | [P] |
| 13.4 | Session titles auto-generate from the first user message after first send | [P] |
| 13.5 | Pin button on a session row moves it to a pinned group (top) | [P] |
| 13.6 | Unpinning moves it back to the regular list | [P] |
| 13.7 | Rename via pencil icon lets you edit the title inline | [P] |
| 13.8 | Rename persists after page refresh | [P] |
| 13.9 | Delete button prompts for confirmation (or uses a destructive style) | [P] |
| 13.10 | Deleting a session removes it from the list and navigates away if it was active | [P] |
| 13.11 | Deleting a session does NOT leave an orphaned route (no 404 on the now-dead URL) | [P] |

---

## 14. Audience toggle

Test all three levels on the same document + same question to confirm the output differs.

| # | Item | P / F / N/A |
|---|---|---|
| 14.1 | Switching audience persists across reload (session detail endpoint saves it) | [P] |
| 14.2 | **Layperson** mode produces plainer language, no jargon | [F] |
| 14.3 | **Professional** mode produces standard business/technical language | [F] |
| 14.4 | **Expert** mode produces technical / precise / domain-specific language | [F] |
| 14.5 | Typing "explain in layman's terms" while Professional is selected auto-switches to Layperson | [P] |
| 14.6 | Typing "give me the expert analysis" auto-switches to Expert | [P] |
| 14.7 | Casual language like "simple question" does NOT falsely trigger an audience switch | [P] |

---

## 15. Retry & Edit

| # | Item | P / F / N/A |
|---|---|---|
| 15.1 | Only the **last** assistant message shows a Retry button | [P] |
| 15.2 | Clicking Retry removes the current assistant reply and re-runs the user prompt | [P] |
| 15.3 | After retry, a new recap + new artifact (if applicable) appears in the same slot | [P] |
| 15.4 | Every user message has an **Edit** (pencil) button | [P] |
| 15.5 | Clicking Edit turns the bubble into a textarea with Save/Cancel | [P] |
| 15.6 | The edit textarea retains the bubble's width (doesn't collapse) | [P] |
| 15.7 | Saving an edit truncates all messages after it and re-runs | [P] |
| 15.8 | Cancelling an edit restores the original bubble | [P] |
| 15.9 | Editing a middle-of-conversation message wipes subsequent turns (not just the next one) | [P] |
| 15.10 | Attached-doc chips on an edited message are preserved | [NA] |

---

## 16. Context meter & compaction

| # | Item | P / F / N/A |
|---|---|---|
| 16.1 | Context meter shows a percentage and a filled bar | [P] |
| 16.2 | Meter updates as the run progresses | [F] |
| 16.3 | Clicking **Compact** manually triggers compaction | [NA] |
| 16.4 | During compaction, the button shows a loading state | [NA] |
| 16.5 | After compaction, the meter drops to a lower percentage | [NA] |
| 16.6 | A `compaction_done` entry appears in the Agent Trace | [NA] |
| 16.7 | On a very long conversation (simulate by sending 10+ messages), auto-compaction fires at ~85% (note the actual trigger: ___%) | [NA] |
| 16.8 | After auto-compaction, the conversation still renders correctly (no missing messages) | [NA] |

---

## 17. In-session search

| # | Item | P / F / N/A |
|---|---|---|
| 17.1 | Clicking the search icon in the input bar reveals a search field | [P] |
| 17.2 | Typing a query highlights matches in the messages (amber/yellow highlight) | [P] |
| 17.3 | The counter shows `1 / N` where N is the total match count | [P] |
| 17.4 | **Enter** jumps to the next match and scrolls it into view | [P] |
| 17.5 | **Shift+Enter** jumps to the previous match | [P] |
| 17.6 | The current match is styled differently from other matches (more vivid highlight) | [P] |
| 17.7 | Esc closes the search and clears the query | [P] |
| 17.8 | Search works on both user and assistant messages | [P] |
| 17.9 | Search does NOT match inside citation UUIDs (or if it does, it's intentional) | [P] |
| 17.10 | Clearing the query removes all highlights | [P] |

---

## 18. Stop & error handling

| # | Item | P / F / N/A |
|---|---|---|
| 18.1 | Clicking **Stop** during streaming halts the run within ~2s | [P] |
| 18.2 | A "[stopped]" indicator appears on the partial reply | [P] |
| 18.3 | After stop, input is re-enabled | [P] |
| 18.4 | Killing the backend mid-stream surfaces a readable error (not a silent hang) | [NA] |
| 18.5 | Disconnecting WiFi mid-stream : UI recovers gracefully after reconnect | [NA] |
| 18.6 | Sending a message with no document uploaded still works (or shows a helpful empty-state) | [P] |
| 18.7 | Sending a nonsensical prompt ("asdfghjkl") still returns a reply without crashing | [P] |

---

## 19. Persistence across reloads

After a full run completes, refresh the browser (Ctrl/Cmd+R):

| # | Item | P / F / N/A |
|---|---|---|
| 19.1 | The user + assistant messages all reappear in order | [P] |
| 19.2 | Inline citations still clickable after reload | [P] |
| 19.3 | Generated artifact buttons still visible under the right assistant message | [P] |
| 19.4 | Clicking an artifact button after reload opens the preview canvas | [P] |
| 19.5 | Agent trace events reappear (persisted trace) | [P] |
| 19.6 | Context meter shows a seeded value (not stuck at 0) | [P] |
| 19.7 | Audience toggle matches what was set before reload | [P] |
| 19.8 | Session title matches (no reset to default) | [P] |
| 19.9 | Thinking panel for past turns is collapsible but collapsed by default | [F] |

---

## 20. Multi-session behaviour

| # | Item | P / F / N/A |
|---|---|---|
| 20.1 | Open session A, start a run, switch to session B mid-stream : B shows its own history, A's stream continues in the background (or reattaches when you return) | [F] |
| 20.2 | Returning to A shows the completed run (no duplicated messages) | [F] |
| 20.3 | Starting a run in A then immediately in B : both complete and are stored under the right session | [F] |
| 20.4 | Uploading a file in A does not appear in B's session files | [P] |
| 20.5 | Deleting A while B is streaming does not affect B | [P] |

---

## 21. File management within a session

| # | Item | P / F / N/A |
|---|---|---|
| 21.1 | Session header's "files" menu lists all attached documents | [P] |
| 21.2 | Session header's files menu lists all generated artifacts | [P] |
| 21.3 | Clicking an artifact in the menu opens the preview | [P] |
| 21.4 | Uploading an additional document mid-session works (drag onto input bar or via + button) | [P] |
| 21.5 | New document is immediately available to subsequent questions | [P] |
| 21.6 | Upload zone / modal closes after a successful upload | [P] |

---

## 22. Visual polish & accessibility

| # | Item | P / F / N/A |
|---|---|---|
| 22.1 | All buttons have hover states (colour or background change) | [P] |
| 22.2 | All interactive elements show a pointer cursor | [P] |
| 22.3 | Focus outlines are visible when tabbing through elements | [P] |
| 22.4 | Text contrast is readable (no grey-on-grey that's hard to read) | [P] |
| 22.5 | Tooltips on icon buttons appear on hover (Copy, Edit, Retry, etc.) | [P] |
| 22.6 | No element overflows its container at any viewport ≥1024px | [P] |
| 22.7 | Scroll bars appear where needed (long messages, long trace panels) and don't double up | [P] |
| 22.8 | No layout shift ("jumpy" content) during streaming | [P] |
| 22.9 | Font rendering is consistent (monospace only in code blocks and thinking panel) | [P] |
| 22.10 | No obvious emoji or test strings left over from development | [P] |

---

## 23. Cross-browser spot checks

Repeat sections 1, 6, and 9 in at least two browsers.

| Browser | Splash loads | Start chat works | Final delivery flow works |
|---|---|---|---|
| Chrome | [P] | [P] | [P] |
| Firefox | [P] | [P] | [P] |
| Edge / Safari | [P] | [P] | [P] |

---

## 24. Negative / adversarial scenarios

| # | Item | P / F / N/A |
|---|---|---|
| 24.1 | Submit a message while already streaming : the Send button should be disabled; nothing queues up incorrectly | [P] |
| 24.2 | Upload a 0-byte file : readable error, not a silent success | [NA] |
| 24.3 | Upload a 100MB+ file : either accepted with a progress indicator, or rejected with a size-limit error | [P] |
| 24.4 | Send a message containing `[uuid-like-string]` that isn't a real chunk : citation link click does not crash the drawer | [P] |
| 24.5 | Rapid-click the Send button 5 times : only one request is issued | [P] |
| 24.6 | Rapid-click Retry 3 times : only one retry runs | [P] |
| 24.7 | Rename a session to empty string : falls back to the original title or is rejected | [P] |
| 24.8 | Rename a session to a 500-character string : truncates in the UI, persists correctly | [P] |
| 24.9 | Delete the last session : sidebar shows empty state, app does not crash | [P] |
| 24.10 | Paste a very large block (~50KB) of text into the input : counter updates, UI doesn't freeze | [P] |

---

## 25. Backend API sanity (optional : requires `curl` / Postman)

| # | Item | P / F / N/A |
|---|---|---|
| 25.1 | `GET http://localhost:8000/sessions` returns a JSON list |[P] |
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
| 1 | 7.4 |Attached document chips do not appear inside the user bubble unlike those in claude.ai or ChatGPT | Attached document chips appear inside the user bubble |upload file to messagr bar and sent to the agentic system. document chip did not appear though the file is stored in the session files tab |minor | |
| 2 | 9.1 | When the lead calls finalize, the letter-by-letter typing is not visible on the frontend to the user. Only a final completed generated text is shown in 1 chunk| When the Lead calls `finalize`, the final message begins typing in letter-by-letter (typewriter animation) | upload file, send prompt: "summarise the document", wait for agentic system to generate|minor | |
| 3 | 9.2 | Non-existent as outlined in item 9.1| The typewriter speed feels natural : not instant, not sluggish (should take ~8–12s for a ~500-word recap) | see item 9.1| minor| |
| 4 | 9.3 |The typewriting is non-existent as pointed our in section 9.2 | A blinking cursor ▋ appears at the end of the text while it's typing | see item 9.1| minor| |
| 5 | 9.11 | non-existent as outlined in item 9.1| After streaming finishes, the blinking cursor disappears | see item 9.1|minor | |
| 6 | 12.6 | the summary is partially cut off | `agent_done` rows show a summary | same reproduction steps for item 9.1 and click on agents_done under agent trace when it appears|minor | |
| 7 | 14.2 |keeping prompt same but switching the mode to layperson does not seem to be working | **Layperson** mode produces plainer language, no jargon |switched to layperson, sent prompt: :summarise this document for me" |major | |
| 8 | 14.3 | same as item 14.2| **Professional** mode produces standard business/technical language | same as item 14.2|major | |
| 9 | 14.4 |same as item 14.2 | **Expert** mode produces technical / precise / domain-specific language |same as item 14.2 |major | |
| 10 | 16.2 |context window percentage meter bar does not appear to be cumulative overtime. instead it shows a new context window percentage for every input message + thought process generated. Unsure if output is contributed part of it. | Meter updates as the run progresses |Upload file, send prompt to sumamrise the document and send follow-up prompts related to the first one | major| |
| 11 | 19.9 | The thinking panel for past turns disappears | Thinking panel for past turns is collapsible but collapsed by default | |minor | |
| 12 | 20.1 | Session A run was interupted. streaming did not continue after a few minutes after returning on the frontend | Open session A, start a run, switch to session B mid-stream : B shows its own history, A's stream continues in the background (or reattaches when you return) | | major| |
| 13 | 20.2 |switching different chat sessions during session A run appears to disrupt it, causing no output to be shown on the frontend | Returning to A shows the completed run (no duplicated messages) | |major | |
| 14 | 20.3 |same issue raised for 20.1 and 20.2 | Starting a run in A then immediately in B : both complete and are stored under the right session | |major | |

---

## Free-form observations

> Anything that didn't fit the checklist : UX friction, unclear labels, surprising behaviour, performance impressions, copy suggestions.

- uploaded session files cannot be deleted or removed
- switching layperson, professional and expert modes should appear in the chat interface as "~  switched to layperson mode ~" in the centre. 
- file previewer canvas should include a copy button alongside with download and close
- generated artefact button can be reduced in size, whereby the size is dependent on the title generated for the generated artefact.
- when asking questions that use the agentic system historical knowledge, the thought process messages appear to be mixed with the streaming animation of the actual message output response. the final message output is thus appeared as a single chunk of text thrown to the user but contain no thought process inside.
- will need to investigate how is the percentage context window meter progress bar calculated. the context used appears different from the token counter beside it and this discrepancy is causing confusion where rightfully they should be the same?

---

## Sign-off

- [ ] All critical items (Sections 9, 10, 15, 18, 19) pass
- [✓]  Issue Log is complete for every **F** above
- [ ] Screenshots / recordings attached for visual bugs

**Tester signature:** _______________
**Date completed:** ________25 Apr_______
