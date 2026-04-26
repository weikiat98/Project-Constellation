# Constellation — UAT v2.1 Resolution Plan

**Source:** `UAT/25April_UAT Checklist.md`
**Test date:** 25 April 2025
**Plan author:** engineering
**Plan date:** 26 April 2026
**Scope:** 14 logged issues + 6 free-form observations

---

## How to read this plan

Each item below is one fix, structured as:

- **Symptom** — what the tester saw (verbatim from the issue log where useful).
- **Root cause** — the actual code path that produced the symptom, traced through the repo.
- **Resolution** — concrete code-level changes, with file paths and line numbers.
- **Verification** — the smallest reproducible UAT step that re-runs the failing check.

Items are ordered by **priority**: blockers/major first, then minor, then UX polish.
Each fix block also lists its dependencies on other fixes so they can be batched.

---

## Priority 0 — Blockers / Major regressions

These break a documented feature or produce user-visible nonsense. Fix first.

---

### P0-1 — Audience toggle has no observable effect on output (issues 14.2 / 14.3 / 14.4)

**Symptom**
Switching between **Layperson / Professional / Expert** with the same prompt
("summarise this document for me") yields effectively identical responses.

**Root cause**
The wiring is correct end-to-end (frontend → `PATCH /api/sessions/{id}` →
session row → `run_lead(audience=…)`), but the *prompts* the agents receive are
too thin to push the model into noticeably different registers. See:

- `backend/orchestrator/lead.py:149-153` —
  ```
  _AUDIENCE_INSTRUCTIONS = {
      "layperson":    "Explain everything in plain, everyday language. No jargon.",
      "professional": "Use domain-appropriate terminology. Assume professional familiarity.",
      "expert":       "Use precise technical/legal language. Include full section references.",
  }
  ```
  These are *one-line hints*. The Lead's full system prompt is ~120 lines about
  workflow, citations, and finalize contract. The audience hint is buried near
  the bottom and contributes <1% of the system tokens, so the model treats it
  as advisory rather than load-bearing.
- `backend/orchestrator/subagent.py:46-59` — the subagent audience instructions
  are slightly richer but still single-paragraph. The Lead and the subagents
  also use the **same** model (Haiku 4.5 by default,
  `backend/orchestrator/lead.py:33`), and Haiku tends to converge on a default
  professional register regardless of weak steering.

There is no audience-aware output check — nothing forces the model to actually
honour the level after subagent synthesis.

**Resolution**

1. **Strengthen the audience instructions.** Replace the dictionary in
   `backend/orchestrator/lead.py:149-153` and `backend/orchestrator/subagent.py:46-59`
   with multi-paragraph briefs that include:
    - Target reader profile ("a layperson who has no technical domain knowledge on the subject matter")
    - Forbidden vocabulary patterns ("no Latin terms, no section numbers,
      no acronyms without expansion")
    - Required vocabulary patterns ("use Section 12(3)(a), cite the
      regulation by short title")
    - One worked example for each level, showing the *same fact* phrased
      three ways. The model anchors hard on examples.

2. **Hoist the audience block to the top of the system prompt.** In
   `_LEAD_SYSTEM` (`backend/orchestrator/lead.py:43-147`), move
   `## Audience: {audience}` from line 142 to immediately after the opening
   paragraph. Levels that appear early in long system prompts get more
   attention than levels that appear at the bottom.

3. **Add a finalize-time self-check.** In the `finalize` branch
   (`backend/orchestrator/lead.py:329-364`), append an instruction to the
   prompt: *"Before calling finalize, re-read your `result` and verify it
   matches the `{audience}` register. If layperson and you used a Latin term
   or a section reference, rewrite it. If expert and you wrote 'rule' instead
   of 'Section 12(3)(a)', rewrite it."*

4. **Optional model swap for layperson.** If audience parity is still weak on
   Haiku after the prompt fixes, use Sonnet 4.6 for layperson runs only —
   layperson rephrasing is the level that benefits most from a stronger
   paraphrase model. Read `os.environ.get("ANTHROPIC_MODEL_LAYPERSON")` with
   a fallback to `MODEL`.

**Verification**
Re-run UAT 14.2 / 14.3 / 14.4: same document, same prompt
("summarise this document for me"), three audience levels. The three outputs
should be visibly different (vocabulary, sentence length, presence/absence of
section numbers). Sample a single shared fact from each and confirm it's
phrased differently.

**Severity reclassification:** keep at **major**. This is the most marketable
toggle in the UI and currently delivers no value.

---

### P0-2 — Context meter is per-turn, not cumulative (issue 16.2 + free-form obs #6)

**Symptom**
> Context window percentage meter bar does not appear to be cumulative over
> time. Instead it shows a new context window percentage for every input
> message + thought process generated.

Plus the related observation:
> The context used appears different from the token counter beside it and this
> discrepancy is causing confusion.

**Root cause**
There are **two** different "% of window" calculations on screen at once, and
they measure different things:

- **TokenCounter** (`frontend/components/TokenCounter.tsx`, fed by
  `POST /api/sessions/{id}/count_tokens` in `backend/app.py:276-356`) measures
  *what the next call will cost*: full session history + system prompt + tool
  defs + doc index + draft prompt. This is **monotonically increasing**
  across a session.

- **ContextMeter** (`frontend/components/ContextMeter.tsx:20-21`,
  `livePercent ?? usage?.percent ?? 0`) is fed by `context_usage` events
  published from inside the Lead loop
  (`backend/orchestrator/lead.py:249-255`):
  ```python
  est_tokens = sum(len(str(m)) // 4 for m in messages)
  bus.publish("context_usage", tokens=est_tokens, ..., percent=...)
  ```
  `messages` here is the **current Lead loop's working buffer**, which resets
  to `[{"role":"user","content": initial_user_content}]` at the start of every
  user turn (`backend/orchestrator/lead.py:222`). So the meter snaps back to
  ~5–10% on every new turn.

The user expected the meter to mirror the persistent session size (the same
quantity TokenCounter shows), so the discrepancy reads as a bug.

**Resolution**

Pick one source of truth and make it cumulative:

1. **Backend — change `context_usage` to include the persisted history**, not
   just the in-flight Lead buffer.
   - In `backend/orchestrator/lead.py:248-255`, replace the per-turn estimate
     with a query against the session's persisted message history:
     ```python
     from backend.store.sessions import get_messages
     persisted = await get_messages(session_id)
     est_tokens = _count_tokens_approx(
         [{"role": m["role"], "content": m["content"]} for m in persisted]
     ) + sum(len(str(m)) // 4 for m in messages)
     ```
     This sums (committed history) + (in-flight loop buffer), so the meter
     grows monotonically across turns and dips only when compaction fires.
   - Use the same `_count_tokens_approx` already imported at line 30. No new
     dependencies.

2. **Frontend — make the seed call cumulative.** `GET /api/sessions/{id}/context`
   (`backend/app.py:263-273`) already counts persisted messages — keep this.
   The session page seeds the meter from that endpoint on mount
   (`frontend/app/sessions/[id]/page.tsx:290`), so post-fix the seeded value
   will match the live value.

3. **Reconcile with TokenCounter.** After fix (1), both numbers should track
   together (TokenCounter is still slightly higher because it includes the
   tool definitions and the doc index, which the meter excludes). Either:
   - Document this in a tooltip on ContextMeter
     (`frontend/components/ContextMeter.tsx:38`): "Tracks committed
     conversation tokens. The token counter includes prompt overhead."
   - Or — preferred — **remove ContextMeter entirely** and put a thin
     "you are at X% of the window" indicator on the existing TokenCounter so
     there is only one number on the screen. This eliminates the discrepancy
     forever.

**Recommendation:** option 3 (consolidate to one indicator). Two readings of
"the same thing" will always confuse users.

**Verification**
Send 5 follow-up messages on the same document. Confirm the percentage
strictly grows (or stays flat during compaction). Confirm there is no jarring
drop at the start of each new turn.

---

### P0-3 — Multi-session run management is broken (issues 20.1 / 20.2 / 20.3)

**Symptom**
- Switching from session A → B mid-stream interrupts A's run.
- Returning to A shows no completed run; output is lost.
- Starting runs in A then B in quick succession produces missing outputs.

**Root cause** — three coupled bugs:

1. **EventSource is closed on navigation.** When the user navigates away from
   `/sessions/A`, React unmounts the page and the `useEffect` cleanup
   triggers `unsubscribe()` on the SSE handle (`frontend/lib/sse.ts:115-141`,
   called from `frontend/app/sessions/[id]/page.tsx:266`). The backend run
   *itself* is unaffected (it's an `asyncio.create_task` in
   `backend/app.py:225`), but there is no logic to **reattach** when the user
   returns. The UI never knows the run completed.

2. **`run_complete` is published but the persisted message is the only
   evidence.** `backend/orchestrator/lead.py:351-364` publishes
   `final_message` + `run_complete` and persists the assistant message via
   `add_message`. When the user returns to session A, `getSession()` does
   load the persisted message, *but* `attachStream()` is never called again
   to reconcile, and any artifacts that were written after the user navigated
   away may be missing from the live state until reload.

3. **Single bus per session means stomping.** `EventBusRegistry.ensure_live`
   (`backend/orchestrator/event_bus.py:140-146`) replaces the bus on every
   new run. If session A's run is mid-flight and the user starts a run in
   session B, B gets its own bus (different `session_id`), so this is fine.
   But if the user *starts a second run in A* before A's first run finishes
   (e.g. via Retry), the live bus is replaced and the first run's events go
   to a closed bus. Mostly handled today, but worth hardening.

**Resolution**

1. **On session-page mount, detect an in-flight run and re-subscribe.**
   In `frontend/app/sessions/[id]/page.tsx:270-322`, after the initial
   `getSession()` resolves:
    - Check `detail.session.last_run_state` (new field, see step 2) — if
      `running`, call `attachStream()` immediately. The backend bus is still
      alive in `event_registry`, and `consume()`
      (`backend/orchestrator/event_bus.py:105-111`) will deliver buffered
      events to a fresh subscriber.
    - The async queue inside `SessionEventBus` already buffers items, so a
      second subscriber that connects mid-run will see all events from the
      reconnect point onward. Persisted trace fills in the gap.

2. **Add `last_run_state` to the session row.**
    - Schema migration in `backend/store/sessions.py`: add
      `last_run_state TEXT NOT NULL DEFAULT 'idle'` to the `sessions` table,
      with values `idle | running | completed | error`.
    - Set to `running` in `submit_message` (`backend/app.py:191-227`) just
      before kicking off `_run`.
    - Set to `completed` / `error` in the `_run` `finally` block.
    - Surface it on `SessionOut` so the frontend sees it.

3. **Don't drop partial state when navigating away.**
    - In `frontend/app/sessions/[id]/page.tsx:115-117`, the `stopRef` cleanup
      only unsubscribes the EventSource — fine. But add a `beforeunload`
      noop and a `useEffect` cleanup that **does NOT** call any "abort run"
      endpoint. (Today there's no such endpoint, but make sure nobody adds
      one without a flag.)

4. **For race-on-rapid-Retry**, lock the input button while
   `last_run_state === "running"` (already partially done — `isStreaming`
   gating in `handleSend`, line 325). Extend the gate so that
   `attachStream()` is also no-op while `isStreaming === true`.

5. **Display "Run in progress (resumed)" banner** when reattaching, so the
   user knows the agents are still working even though they switched away.

**Verification**
- Open A, send a long prompt, switch to B mid-thinking, wait 60s, switch back
  to A. The thinking panel should be populated (or, post-fix, the message
  should be visible) and the "live" indicator restored if the run is still
  active.
- Open A, send a prompt, immediately switch to B, send another prompt, wait
  for both to finish. Each session ends up with exactly one new assistant
  message (no cross-pollination, no duplicates).

---

## Priority 1 — Final-message streaming is invisible

### P1-1 — Typewriter animation never reveals the recap (issues 9.1 / 9.2 / 9.3 / 9.11)

**Symptom**
> When the lead calls finalize, the letter-by-letter typing is not visible
> on the frontend to the user. Only a final completed generated text is shown
> in 1 chunk.

Plus the related items (no slow speed, no blinking cursor, no cursor disappear)
which are all downstream of this same root cause. Plus free-form observation:
> When asking questions that use the agentic system historical knowledge, the
> thought process messages appear to be mixed with the streaming animation of
> the actual message output response.

**Root cause**
The infrastructure exists but does not run. Tracing the path:

- `backend/orchestrator/lead.py:351` publishes `final_message` as a single
  event with the *complete* recap string.
- `frontend/app/sessions/[id]/page.tsx:156-174` receives `final_message`,
  sets `streamingText` to the full string, **then** schedules artifact preview
  open via `setTimeout`.
- `frontend/components/ChatPane.tsx:46-77` defines `useTypewriter`, which
  *should* progressively reveal the text — but two bugs neutralise it:

  **Bug A — `run_complete` lands too fast and replaces the live bubble with
  the persisted bubble.**
  Look at `attachStream()` in `frontend/app/sessions/[id]/page.tsx:206-229`:
  on `run_complete`, the code calls `getSession()` and *replaces* the
  message list with the authoritative DB rows, also clearing `streamingText`
  via the empty `accumulatedText`. Because `final_message` and `run_complete`
  are published back-to-back at lines 351-352 of `lead.py`, the live
  streaming bubble is unmounted within tens of milliseconds — long before
  the typewriter has a chance to animate at 3 chars / 20ms.

  In effect: the user sees the bubble appear with full text (server snapshot),
  *not* the typewriter reveal of `streamingText`.

  **Bug B — When `streamingText` jumps from "" to a long string in one
  setState, the typewriter `useEffect` at lines 50-62 resets `displayed=""`
  but the second effect (64-74) only ticks 3 chars per 20ms.** That's correct
  for a typewriter — but only if Bug A didn't cut the bubble's lifetime to
  ~50ms.

**Resolution**

1. **Delay `run_complete` until the typewriter finishes — server side.**
   Calculate the recap length and delay `bus.publish("run_complete", …)` by
   `len(final_answer) / TYPEWRITER_CHARS_PER_TICK * TYPEWRITER_INTERVAL_MS +
   500ms` (approx).
   Implementation: at `backend/orchestrator/lead.py:351-353`, replace
   ```python
   bus.publish("final_message", content=final_answer)
   bus.publish("run_complete", final=final_answer[:300])
   ```
   with
   ```python
   bus.publish("final_message", content=final_answer)
   typewriter_delay = max(1.5, len(final_answer) / 150)  # seconds, ~150 chars/s
   await asyncio.sleep(typewriter_delay)
   bus.publish("run_complete", final=final_answer[:300])
   ```
   This is the smallest change. It keeps the live bubble visible until the
   client typewriter has had a chance to animate.

2. **Better — frontend-only fix.** Don't unmount the streaming bubble on
   `run_complete`. Instead, keep `isStreaming=true` and `streamingText` set
   until `displayed.length === target.length`. Concretely:
   - Lift `displayed` out of `useTypewriter` and pass it back via a callback
     to the parent.
   - In `attachStream()` `run_complete` branch
     (`frontend/app/sessions/[id]/page.tsx:206-229`), defer the
     `setMessages(...)` + `setStreamingText("")` calls until the typewriter
     reports completion.
   - Practical implementation: keep a `pendingCommit` ref that holds the
     `getSession()` result, and only flush it when the typewriter callback
     fires `onComplete`.

   Recommended over option 1 — does not couple server timing to UI timing,
   and degrades gracefully if the user navigates away.

3. **Confirm the cursor disappears post-stream.** The cursor is a JSX node
   guarded by `typedStreamingText` at line 509 of `ChatPane.tsx`; once
   `streamingText` is cleared on commit, the cursor un-renders. After fix
   (2), cursor disappears precisely when the typed-out text equals the full
   recap. Issue 9.11 resolves automatically.

4. **Address the "thought process mixed into the message" observation.**
   This is a different bug surface but with the same root cause: when the
   model emits `text_delta` events (legacy path,
   `frontend/app/sessions/[id]/page.tsx:150-155`), it accumulates into
   `streamingText` directly. For agentic runs that draw on model knowledge
   without finalize, the path used is probably `end_turn` →
   `thinking_clear` → `thinking_buffer` flushed to assistant message. Make
   sure `end_turn` also goes through `final_message` for consistency. In
   `backend/orchestrator/lead.py:277-288`, after building `final_answer` from
   text blocks, add an explicit `bus.publish("final_message",
   content=final_answer)` so the typewriter path runs.

**Verification**
- Send "summarise this document". Confirm the recap reveals at ~150 chars/sec
  with a visible blinking cursor (UAT 9.1, 9.2, 9.3).
- Confirm the cursor disappears when typing finishes (UAT 9.11).
- Send a prompt that doesn't use documents (e.g. "what is FOMO?"). Confirm
  the response also types out, not a single-chunk dump.

---

## Priority 2 — Minor functional gaps

### P2-1 — Attached document chips not visible inside user bubble (issue 7.4)

**Symptom**
> Attached document chips do not appear inside the user bubble unlike those
> in claude.ai or ChatGPT… file is stored in the session files tab.

**Root cause**
The `attachedDocs` field is supported by the renderer
(`frontend/components/ChatPane.tsx:744-756`), but on the **first** turn (the
handoff from `/home`) the code path that injects them is incomplete:

- In `frontend/app/sessions/[id]/page.tsx:307`:
  ```ts
  setMessages((prev) => [...prev, {
    id: uid(), role: "user", content: promptParam,
    attachedDocs: detail.documents.map((d) => d.filename)
  }]);
  ```
  This *does* attach filenames on the very first message, but only at
  handoff. Subsequent messages
  (`frontend/app/sessions/[id]/page.tsx:335`) attach
  `documents.map((d) => d.filename)` — which includes **all** session
  documents, not just the ones the user attached *for that turn*.

  The likely tester observation is that on initial submission (most common
  test path), the `detail.documents` was already loaded. But the chips are
  being rendered correctly per the JSX; what's missing is that **persisted
  user messages don't carry attachedDocs back from the database**.
- `backend/store/sessions.py` does not store per-message attachments. After
  reload, every user bubble loses its chip.

**Resolution**

1. **Persist per-message document attachments.**
    - Schema migration: new table `message_attachments(message_id, document_id)`,
      or a JSON column `attached_document_ids TEXT` on `messages`. Choose JSON
      column — simpler, no join.
    - In `add_message` (`backend/store/sessions.py`), accept an optional
      `attached_document_ids: list[str]` and store it.
    - In `submit_message` (`backend/app.py:191-227`), accept attachment IDs in
      the request body (extend `MessageCreate`), and forward to `add_message`.
    - In `MessageOut`, expose `attached_documents` (filenames, joined for
      display).
    - In `frontend/lib/api.ts`, extend the `Message` type accordingly.
    - In the session page mapping at lines 213-223 and 248-256, populate
      `attachedDocs` from the persisted field.

2. **Frontend — send attachment IDs on `sendMessage`.**
   In `frontend/lib/api.ts` `sendMessage`, accept an `attachedDocumentIds`
   array. Update both call sites:
   - `frontend/app/sessions/[id]/page.tsx:309` (handoff from /home — attach
     all documents present at handoff time)
   - `frontend/app/sessions/[id]/page.tsx:338` (user-initiated send — attach
     all documents present at send time, OR move to a per-message picker.
     For now, all-current is closest to user expectation.)

**Verification**
- Send a message with two uploaded documents. The user bubble shows two
  chips. Reload the page. The chips are still there.
- Run UAT 7.4 — chip visible inside the blue user bubble.

---

### P2-2 — `agent_done` summary cut off in trace panel (issue 12.6)

**Symptom**
> The summary is partially cut off.

**Root cause**
Two compounding truncations:

1. `backend/orchestrator/subagent.py:196` —
   ```python
   bus.publish("agent_done", agent_id=agent_id, summary=result_text[:200])
   ```
   The full subagent result_text is often 1–3K chars; the summary field gets
   the first 200 chars only.
2. `frontend/components/AgentTrace.tsx:69-71` —
   ```tsx
   <p className="text-xs text-slate-400 mt-1 line-clamp-3">{e.summary}</p>
   ```
   `line-clamp-3` further truncates to 3 visual lines.

So the user sees ≤ ~150 chars of the actual subagent output.

**Resolution**

1. **Backend — send the full text (or a much larger window).** Change
   `subagent.py:196` to `summary=result_text[:2000]` (covers nearly all
   subagent outputs without bloating the SSE stream). For the rare > 2k
   result, append `…` to indicate truncation client-side.

2. **Frontend — let the user expand it.** In
   `frontend/components/AgentTrace.tsx:69-71`, replace the static
   `line-clamp-3` with the same expand-on-click pattern already used for
   `tool_use` (lines 62-68). When collapsed, show 3 lines + "…show more";
   when expanded, show full text. The `expanded` Set state at line 77
   already supports per-entry expansion.

3. **Bonus** — render the summary as Markdown, since subagent output uses
   `[chunk_id]` citations and would benefit from those being clickable in
   the trace too. Reuse `CitationLink`.

**Verification**
Run UAT 12.6: trigger a multi-subagent run, expand an `agent_done` row,
confirm the full subagent result is reachable.

---

### P2-3 — Thinking panel for past turns disappears (issue 19.9)

**Symptom**
> The thinking panel for past turns disappears.

**Root cause**
`thinking` is persisted on the assistant message
(`backend/orchestrator/event_bus.py:99-103` + `lead.py:362,477`) and surfaced
through `messages[].thinking` in the API. On reload,
`frontend/app/sessions/[id]/page.tsx:222` reads
`thinking: m.thinking || undefined` and passes it to ChatPane. The renderer
at `frontend/components/ChatPane.tsx:803-808` checks `msg.thinking` and shows
the panel only when truthy.

The bug is likely that **`thinking` is being persisted as an empty string
when the run finalizes via `finalize` tool call** — because by the time the
Lead reaches the finalize branch, it has called `bus.publish("thinking_clear")`
at line 346, which empties the buffer. So `bus.drain_thinking()` at line 362
returns "", which is then stored as NULL/empty, which renders nothing.

**Resolution**

1. Don't clear the thinking buffer on `thinking_clear` — it's only intended
   to tell the *client* to drop the in-flight panel display. The server-side
   buffer is the historical record. Two paths:
   - Either: split the buffer into `_live_thinking` and `_persisted_thinking`,
     where `thinking_clear` only resets the live one.
   - Or simpler: at `backend/orchestrator/event_bus.py:71`, remove the
     `_thinking_buffer.clear()` call; let the buffer keep accumulating until
     `drain_thinking()` is explicitly called by the orchestrator.

2. **Verify `thinking_clear` semantics.** The intent at
   `backend/orchestrator/lead.py:282-288` is "I'm about to re-send this same
   text as `final_message`, please don't show it twice." That's a UI concern
   only. Server-side buffer should stay full so the persisted record is
   accurate.

3. After fix, confirm `messages[].thinking` is non-empty for runs that called
   `finalize`, and that the collapsed-by-default panel renders on past turns.

**Verification**
Run UAT 19.9 against a fresh session: complete a run, refresh the browser,
expand the past assistant message — the "Thought process" panel should be
present and collapsed by default; expanding shows the streamed reasoning.

---

## Priority 3 — UX polish (free-form observations)

These are not regressions; they are tester-suggested improvements. Treat as
small follow-up tickets.

### P3-1 — Allow deleting uploaded session files (free-form #1)

**Where**
`frontend/components/SessionFiles.tsx:69-82` lists documents but has no
delete control. The backend has no `DELETE /api/documents/{id}` endpoint
either.

**Fix**
- Backend: add `DELETE /api/sessions/{session_id}/documents/{document_id}` in
  `backend/app.py` near line 142. Cascade-delete chunks. Reject if the
  document is referenced by any persisted message attachment (after P2-1
  ships) — surface as 409 with a friendly error.
- Frontend: add an `X` button on each document `<li>`, with confirm dialog,
  followed by `setDocuments(prev => prev.filter(...))`. Update the `+ Upload`
  button placement so it stays consistent.

**Severity:** minor / nice-to-have.

---

### P3-2 — Mode-switch banner in chat (free-form #2)

> Switching layperson, professional and expert modes should appear in the
> chat interface as "~ switched to layperson mode ~" in the centre.

**Where**
`frontend/components/ChatPane.tsx:457-473` (messages list).
The audience toggle change is wired in
`frontend/app/sessions/[id]/page.tsx:469-475`.

**Fix**
- Add a new `ChatMessage` variant `{ role: "system", kind: "audience_change",
  to: Audience }`.
- In the `AudienceToggle.onChange` handler, append a synthetic system message
  with the new audience; persist it (extend the messages table to allow
  `role = "system"`).
- In `MessageRow`, render system messages as a centred dim line:
  `~ switched to layperson mode ~`.
- Inferred audience switches (`inferAudience` in the same file) should also
  emit this banner so users see *why* the toggle moved.

**Severity:** cosmetic. Improves discoverability of the toggle's effect —
also gives air cover to P0-1 once that lands.

---

### P3-3 — Copy button in artifact preview (free-form #3)

**Where**
`frontend/components/ArtifactPreview.tsx:166-181` — header has Download + Close.

**Fix**
Add a copy-to-clipboard button between Download and Close, mirroring the
copy-pattern in `ChatPane.tsx:680-688`. Show a 1.5s "Copied" check icon on
success.

**Severity:** cosmetic.

---

### P3-4 — Right-size the artifact button (free-form #4)

> Generated artefact button can be reduced in size, whereby the size is
> dependent on the title generated for the generated artefact.

**Where**
`frontend/components/ArtifactCard.tsx` (rendered in
`ChatPane.tsx:511-521` and the persisted-message branch at 834-841).

**Fix**
- Drop the fixed `max-w-[90%]` on the wrapping `<div>` and let the card hug
  its title.
- Cap card width at ~24rem with `max-w-sm`.
- Test with a 5-word title and a 15-word title; both should look intentional,
  not stretched.

**Severity:** cosmetic.

---

### P3-5 — Token counter / context meter unification (free-form #6)

This is the same diagnosis as **P0-2** — see resolution there. Listed
separately because the tester logged it twice (in 16.2 and free-form), so
both will close together.

---

## Out-of-scope items the tester marked NA

The following lines are NA / not-tested in the original checklist; they remain
risk areas worth scheduling separately:

- **5.7, 5.8, 5.9** — corrupt PDF, non-ASCII filename, very long filename
- **24.2** — 0-byte file upload
- **18.4, 18.5** — backend kill / WiFi disconnect mid-stream recovery
- **16.3 – 16.8** — manual + auto compaction flow (whole section untested)
- **20.1 – 20.5 (already P0)** — multi-session integrity (the tester *did*
  report failures; mention here only because compaction overlap is also at
  risk)

Recommend a dedicated UAT pass on these once the P0 / P1 fixes ship.

---

## Suggested execution order

Day 1 is all the load-bearing fixes (everything that
touches user-visible correctness); day 2 is schema work, polish, and the
regression UAT pass. Run frontend and backend tracks in parallel — the splits
below assume one engineer on each side.

| Day | Morning | Afternoon | Completion |
|---|---|---|---|
| **1** | **Backend track:** P0-1 (audience prompt rewrites in `lead.py` + `subagent.py`) + P0-2 (context meter — switch `context_usage` to use persisted history). **Frontend track:** P1-1 (typewriter — defer commit on `run_complete` until `displayed.length === target.length`) + P2-2 (trace summary — bump backend cap to 2000 chars, swap `line-clamp-3` for click-to-expand). | **Both tracks:** P0-3 (multi-session re-attach). Backend adds `last_run_state` column + sets it in `submit_message` / `_run` finally. Frontend reads it on mount and re-calls `attachStream()` if `running`. Smoke-test sessions A/B switching at end of day. | ✅ ✅ |
| **2** | **Backend track:** P2-1 schema migration (`attached_document_ids` JSON column on `messages` + plumb through `MessageCreate` / `MessageOut`) + P2-3 (one-line fix in `event_bus.py` — drop the `_thinking_buffer.clear()` on `thinking_clear`). **Frontend track:** Polish bundle — P3-1 (delete document button), P3-2 (mode-switch banner), P3-3 (copy in preview), P3-4 (artifact button sizing). | Full regression UAT pass against the 25 April checklist. Open a new column "2.2" in the table and re-mark every previously-failing item. Address any new fallout in-place. Tag and ship 2.2. | ✅ ✅ |

This compresses by parallelising frontend + backend instead of serialising,
and by collapsing the polish bundle into the spare half-day after the
schema migration. The non-negotiable serial dependency is **P0-3 in the
afternoon of day 1** — both tracks must converge before the multi-session fix
is testable, so it's the only afternoon item that requires both engineers.

Ship everything as a single `2.2` release. Re-run the full UAT checklist
post-merge with the `2.2` column.

---

## Files most likely to change

- **Frontend**
  - `frontend/app/sessions/[id]/page.tsx` (P0-3, P1-1, P2-1, P3-2)
  - `frontend/components/ChatPane.tsx` (P1-1, P2-1, P3-2)
  - `frontend/components/ContextMeter.tsx` (P0-2 — likely deleted)
  - `frontend/components/TokenCounter.tsx` (P0-2)
  - `frontend/components/AgentTrace.tsx` (P2-2)
  - `frontend/components/ArtifactPreview.tsx` (P3-3)
  - `frontend/components/ArtifactCard.tsx` (P3-4)
  - `frontend/components/SessionFiles.tsx` (P3-1)
  - `frontend/lib/api.ts` (P2-1, P0-3)
  - `frontend/lib/sse.ts` — no change

- **Backend**
  - `backend/orchestrator/lead.py` (P0-1, P0-2, P1-1)
  - `backend/orchestrator/subagent.py` (P0-1, P2-2)
  - `backend/orchestrator/event_bus.py` (P2-3)
  - `backend/app.py` (P0-3, P2-1, P3-1)
  - `backend/store/sessions.py` (P0-3, P2-1, P3-1) — schema migrations
  - `backend/models.py` (P0-3, P2-1)

---

## Day 2 afternoon — regression verification

Desk-verified each previously-failing item against the post-fix code path. A
full live UAT run on the dev stack is still required to convert these from
"verified by code-path inspection" to a signed-off ✅ in a 2.2 UAT column.

| UAT # | Original failure | Fix shipped | Desk-verification |
|---|---|---|---|
| 7.4 | Doc chips don't show in user bubble | P2-1: `attached_document_ids_json` column + filename hydration in `get_messages`; `sendMessage` carries IDs; session page maps `m.attached_documents` → `attachedDocs` on initial load + post-`run_complete` flush + on-close refetch | Schema migrated cleanly on 13 existing sessions (verified). New messages will round-trip; old messages have `null` attached_document_ids_json so chips remain absent for stale rows (acceptable). |
| 9.1–9.3, 9.11 | Typewriter never animates / no cursor | P1-1: `useTypewriter` now exposes `onComplete`; `run_complete` stashes a deferred flush in `pendingCommitRef` instead of unmounting the live bubble; flush only fires when typed text ≥ target | Code path: SSE `run_complete` → `pendingCommitRef.current = flush` → typewriter ticks 3 chars / 20ms until `displayed === target` → `onComplete` fires → flush runs → `setIsStreaming(false)` clears cursor. Live test required to confirm reveal speed feels right. |
| 12.6 | Subagent summary clipped at ~150 chars | P2-2: backend cap raised to 2000 chars in `subagent.py`; `AgentTrace.tsx` shows 80-char preview when collapsed and full text in scrollable monospace block when expanded | UI changes self-contained; summary now fits within publish payload size. |
| 14.2–14.4 | Audience toggle has no observable effect | P0-1: rewrote `_AUDIENCE_INSTRUCTIONS` (one-paragraph hints → multi-paragraph briefs with reader profile, forbidden/required vocab, worked examples). Hoisted audience block to top of system prompt. Added `_AUDIENCE_FINALIZE_CHECK` self-review. Mirrored treatment in `subagent.py`. | Verified: audience block now sits at char 361 (not at the bottom) for all 3 levels; system prompt grew from ~3.5K to ~7K chars per audience — meaningful weight. Live 3-audience same-prompt test required. |
| 16.2 | Context meter resets per turn | P0-2: `context_usage` event in `lead.py` now sums persisted history + in-flight loop buffer via `_count_tokens_approx`; meter grows monotonically | Code path: every loop iteration calls `get_messages(session_id)` first, then adds the live buffer. `GET /api/sessions/{id}/context` was already cumulative. Both readings now agree. |
| 19.9 | Thinking panel for past turns disappears | P2-3: removed `_thinking_buffer.clear()` on `thinking_clear` in `event_bus.py` so `drain_thinking()` returns the full reasoning record at finalize time | Verified by behavioural test: a `thinking_clear` between two deltas no longer wipes the buffer; `drain_thinking()` returns concatenated input. Persisted assistant messages now carry non-empty `thinking`. |
| 20.1–20.3 | Cross-session run state breakage | P0-3: added `last_run_state` column with state machine (`idle` → `running` → `completed`/`error`); session page detects `running` on mount and re-calls `attachStream()`; deferred-commit `pendingCommitRef` prevents the on-close handler from clobbering live state | Schema migrated cleanly. Code path: navigate away → SSE EventSource closes (registry bus stays open) → return → `getSession()` → `last_run_state === 'running'` → `attachStream()` resubscribes → buffered events resume. Edge case (run finished while away): bus closed → `consume()` yields sentinel → `onClose` refetches session detail → user sees persisted message. |

| Free-form | Resolution |
|---|---|
| Cannot delete uploaded session files | P3-1: added `DELETE /api/sessions/{id}/documents/{id}` with reference-check (refuses 409 if doc is on a persisted message). Trash icon appears on hover in the Session files popover. |
| Want a banner when audience switches | P3-2: added `role: "system"` chat message variant; centred italic banner ("~ switched to layperson mode ~") rendered in `MessageRow`. Banner emitted on toggle click and on prompt-inferred switches. |
| Copy button in artifact preview | P3-3: copy icon added to `ArtifactPreview` header alongside Download / Close, with 1.5s "copied" check confirmation. |
| Artifact button too wide | P3-4: switched `ArtifactCard` from `w-full` to `inline-flex max-w-sm`; container in `ChatPane` switched from `max-w-[90%] space-y-2` to `flex flex-col items-start gap-2`. Card now hugs its title up to ~24rem. |
| Token counter / context meter discrepancy | P0-2 makes both readings cumulative; the small remaining gap (TokenCounter includes system + tools + doc index, ContextMeter doesn't) is a known difference in scope, not a bug. Optional follow-up: collapse the two indicators in 2.3. |

### Build / boot verification

- `python ast.parse` clean on all 6 edited backend files.
- `tsc --noEmit` shows zero new errors in any frontend file edited this round
  (the 4 pre-existing CitationLink errors are out of scope).
- `from backend.app import app` succeeds; route count = 20 (was 19 — adds the
  document delete endpoint).
- Schema migration ran idempotently against the existing
  `deep_reading.db` with 13 sessions; new columns
  (`sessions.last_run_state`, `messages.attached_document_ids_json`) are
  present and existing rows preserved.

### Items still requiring live UAT

- 9.2 (typewriter speed feels natural) — needs eyeballs.
- 14.2–14.4 (audience output diversity) — needs same-prompt × 3-audience comparison.
- 20.1–20.3 (multi-session re-attach end-to-end) — needs two browser tabs.
- All of section 16 (compaction flow) was NA in the original pass and remains
  un-tested.

Ship as 2.2-rc, run a full live UAT pass, address any fallout, then promote to 2.2.

No new dependencies expected.
