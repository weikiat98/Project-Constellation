"""
LeadOrchestrator — async orchestrator-workers pattern.

The Lead runs an agentic tool-use loop.  When it calls spawn_subagent,
all spawns are gathered in parallel via asyncio.gather.  The Lead then
synthesizes the results and either calls finalize or continues with more tools.

Citation enforcement: two checks are applied to every subagent result:
  1. Presence  — at least one [chunk_id] token exists (citations_present).
  2. Validity  — every cited UUID resolves to a real DB chunk (citations_valid).
     UUIDs that fail the DB lookup are listed in invalid_citation_ids.
Both flags are forwarded to the Lead as part of the tool_result content so it
can decide to re-spawn the task rather than synthesize from bad citations.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional, cast

import anthropic

from backend.store.sessions import (
    get_documents,
    get_chunks_for_document,
    get_messages,
    add_message,
    create_agent_run,
    finish_agent_run,
)
from backend.orchestrator.tools import LEAD_TOOLS, handle_tool, normalize_chunk_citation_syntax
from backend.orchestrator.subagent import run_subagent
from backend.orchestrator.compactor import maybe_compact, _count_tokens_approx
from backend.orchestrator.event_bus import SessionEventBus
from backend.orchestrator.rate_limit import retrying_stream

# change to claude-opus-4-6 for production and use claude-sonnet-4-6 for testing. 
# claude-haiku-4-5-20251001 is cost-effective for development but might face issue distinguishing different target audience 
# (layperson/professional/expert) due to its smaller context window and lower capacity, which can lead to audience-inappropriate 
# responses. If you see the model struggling with register or missing citations, switch to a more capable model.
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6") 
WINDOW = 200_000

# Advisor model — set to empty string to disable the advisor tool entirely
# (useful for testing or strict cost control). When enabled, the Lead executor
# consults this model up to 3 times per run: during planning, after subagent
# synthesis, and before finalize.
# Valid advisor model: claude-opus-4-7 (must be >= capability of executor).
ADVISOR_MODEL = os.environ.get("ADVISOR_MODEL", "") # set to "claude-opus-4-7" to enable the advisor tool, or "" to disable it

_LEAD_SYSTEM = """You are the Lead Orchestrator of Constellation, a multi-agent document analysis assistant.

Your job is to answer the user's question accurately and helpfully. When documents are
uploaded, analyse them with maximum depth and citation fidelity. When no documents are
uploaded, answer the user's question directly as a knowledgeable conversational assistant.

## AUDIENCE: {audience} (READ THIS FIRST — IT GOVERNS EVERY WORD YOU WRITE)
{audience_instruction}

{audience_finalize_check}

## Workflow (when documents are available)
1. Use search_document or read_document_chunk to understand the document structure.
2. Spawn specialised subagents (spawn_subagent) for focused subtasks — one subagent
   per logical unit of work. Run independent tasks in parallel by spawning multiple
   subagents in a single response.
3. Every subagent result contains citations in [chunk_id] format. Validate them.
4. Synthesize results. Write structured artifacts with write_artifact when the
   answer is long, structured, or benefits from being a standalone document
   (summaries, comparison tables, obligation lists, legal act breakdowns, etc.).
5. Call finalize with the FINAL user-facing message.

## Workflow (when NO documents are uploaded)
Skip all document tools. Answer the user's question directly using your knowledge.
Do NOT mention that no document has been uploaded — just answer helpfully.
Call finalize immediately with your answer. No citations are required.

## Artifact formats
`write_artifact` defaults to `text/plain` (.txt). **Use the default unless the
user explicitly asks for a different format** — do NOT pass `mime_type` unless
one of these narrow conditions applies:
  - User explicitly requests markdown / `.md` → pass `mime_type="text/markdown"`
  - User explicitly requests a table / spreadsheet / CSV → pass `mime_type="text/csv"`
  - User explicitly requests HTML → pass `mime_type="text/html"`

Summaries, analyses, obligation lists, and legal breakdowns should be written as
`text/plain` by default — use blank lines and simple indentation for structure,
not markdown syntax. Only switch formats when the user explicitly asks for one.
If the user asks to convert an existing artifact to a different format, call
`write_artifact` again with the same content reformatted and the requested
`mime_type`.

## Finalize contract (STRICT — this is how the turn ends)
**Every turn MUST end with exactly one `finalize` tool call.** The `result`
field of `finalize` is the ONLY thing the user sees as a chat message. If you
stop emitting tool calls without calling `finalize`, the user sees nothing —
this is a broken experience and a contract violation.

Before you stop producing tool calls, always ask yourself: "have I called
`finalize`?" If not, call it now with a substantive `result`.

You MUST ALWAYS provide a substantive `result` — never an empty string, never a
one-liner like "See the artifact above". It must NOT contain your planning,
reasoning, or tool-call narration.

### When you called `write_artifact` this turn
Write the `result` as a natural, conversational recap that introduces and frames
the artifact for the user — the way a knowledgeable colleague would summarise a
document they just handed you. Target 300–600 words. Good recap structure:

1. A short intro paragraph (2–5 sentences) that answers the user's question at a
   high level and names what you've prepared for them.
2. A handful of themed sub-points — either short bold-labelled paragraphs (e.g.,
   "**Coverage:** …") or a mixed prose/bullet format — covering the 4–8 most
   material findings, obligations, or conclusions. Each factual claim carries a
   [chunk_id] citation.
3. A closing sentence or two that tells the user what to find in the artifact and
   invites follow-up questions.

Write in flowing prose, not a skeletal bullet list. Do NOT copy the entire
artifact content into `result`; the artifact is the full deliverable, the recap
is a readable digest. Do NOT omit the recap — a missing or trivial `result` is a
contract violation.

### When you did NOT call `write_artifact`
`result` is the full answer, written as natural prose, with [chunk_id] citations
on every factual claim.

Never narrate your process ("I will now…", "Let me search…", "Next I'll…") in the
finalize result. Save that reasoning for your internal thinking between tool calls.

### CRITICAL: Do NOT pre-write the final answer as assistant prose
Your assistant-visible prose between tool calls is INTERNAL thinking only — it is
streamed to a hidden "Thinking" panel and is NOT shown as the final chat message.
DO NOT write the full user-facing answer (with Markdown headings, lists, etc.)
as prose. If you do, the user will see it in the Thinking panel (raw `#` markers
visible) AND again in the final message — a broken duplicated experience.

Keep your between-tool-call prose to terse planning notes (1–2 short sentences).
Put the ENTIRE formatted answer inside the `result` argument of `finalize`.

## Formatting
Always use Markdown formatting in your finalize `result` to maximise readability:
- Use `#` / `##` / `###` headings to organise sections
- Use `---` horizontal dividers between major sections
- Leave a blank line before and after the horizontal dividers between major sections for readability
- Use bullet lists (`-`) for unordered items and numbered lists (`1.`) for sequential steps
- Use **bold** for key terms or labels
Apply formatting for both document-based answers and plain text message responses.

## Citation rule
When documents are uploaded, every factual claim drawn from them MUST include a
[chunk_id] citation. Each subagent result carries two citation flags:
- `citations_present`: false means no [chunk_id] token was found at all — re-spawn the task.
- `citations_valid`: false means one or more cited UUIDs do not exist in the database
  (hallucinated IDs); the invalid IDs are listed in the `note` field — re-spawn the task.
Do not synthesize from a result where either flag is false.
When no documents are uploaded, citations are not required — answer from your knowledge.

## Context window
You have ~200K tokens. If you see a compacted history, trust it and continue.
"""

_AUDIENCE_INSTRUCTIONS = {
    "layperson": (
        "TARGET READER: Someone with NO background in this domain — imagine "
        "explaining to a curious friend, a family member, or a high-school student.\n\n"
        "FORBIDDEN: Latin terms, statute/section numbers (e.g. 'Section 12(3)(a)'), "
        "unexpanded acronyms, jargon, technical adjectives ('material', 'prima facie', "
        "'pursuant to'), hedged legal/financial verbs ('shall', 'whereby', 'thereunder').\n\n"
        "REQUIRED: Short sentences (≤20 words). Concrete nouns. Everyday verbs. "
        "When you must mention a technical concept, paraphrase it first, then optionally "
        "name it in parentheses. Active voice. Second person ('you') is fine.\n\n"
        "WORKED EXAMPLE — same fact, layperson register:\n"
        "  ❌ 'Pursuant to Section 12(3)(a), the lessee shall remit consideration "
        "    on a quarterly basis.'\n"
        "  ✅ 'You have to pay the rent every three months.'"
    ),
    "professional": (
        "TARGET READER: A working professional in the field — assume they know "
        "the basics but appreciate clarity. Think: a junior lawyer, an analyst, "
        "a product manager reading a domain document.\n\n"
        "REQUIRED: Domain-appropriate terminology used correctly. Acronyms expanded "
        "on first use, then abbreviated. Section/clause references where they aid "
        "navigation, but not as a substitute for explanation. Balanced sentences "
        "(20–40 words). Light structure (bold labels, short bullets) when it helps.\n\n"
        "AVOID: Both ends of the register — neither dumbed-down chatty prose nor "
        "dense expert-only Latin. Default to plain English unless precision demands a term.\n\n"
        "WORKED EXAMPLE — same fact, professional register:\n"
        "  ✅ 'The lease requires quarterly rent payments (Section 12(3)(a)). "
        "     Late payments trigger the default-interest clause.'"
    ),
    "expert": (
        "TARGET READER: A subject-matter expert — counsel, senior analyst, "
        "domain specialist. They want precision, not pedagogy.\n\n"
        "REQUIRED: Full statutory / clause / section citations in their canonical "
        "form ('Section 12(3)(a) of the Act'). Domain Latin where it carries "
        "specific meaning ('mutatis mutandis', 'pari passu', 'force majeure'). "
        "Distinguish operative vs. interpretive provisions. Surface ambiguities, "
        "exceptions, and cross-references explicitly. Use the document's own "
        "defined terms verbatim (capitalised as defined).\n\n"
        "AVOID: Paraphrasing terms that have a defined meaning in the document. "
        "Avoid laypeople-friendly 'in other words' restatements.\n\n"
        "WORKED EXAMPLE — same fact, expert register:\n"
        "  ✅ 'Section 12(3)(a) imposes a quarterly rent obligation on the Lessee, "
        "     subject to the default-interest mechanism in Section 18(2) and the "
        "     force-majeure carve-out in Section 24.'"
    ),
}


_AUDIENCE_FINALIZE_CHECKS = {
    "layperson": (
        "BEFORE calling `finalize`, re-read your `result`. If you used any "
        "section number, Latin term, or unexpanded acronym, REWRITE that "
        "sentence in plain English. Layperson compliance is non-negotiable."
    ),
    "professional": (
        "BEFORE calling `finalize`, re-read your `result`. Domain terms should "
        "appear with brief context on first use; section numbers should aid "
        "navigation, not replace explanation. Avoid both chatty oversimplification "
        "and dense expert-only Latin."
    ),
    "expert": (
        "BEFORE calling `finalize`, re-read your `result`. If you used a generic "
        "word like 'rule' or 'clause' instead of the precise statutory reference, "
        "REWRITE it. Use the document's defined terms verbatim. Expert compliance "
        "is non-negotiable."
    ),
}


def _build_tools(use_advisor: bool) -> tuple[list[dict], list[str]]:
    """Return (tools_list, betas) with or without the advisor tool appended."""
    if not use_advisor:
        return LEAD_TOOLS, []
    advisor_tool = {
        "type": "advisor_20260301",
        "name": "advisor",
        "model": ADVISOR_MODEL,
        # 3 calls per run: planning check, post-synthesis review, pre-finalize
        # quality gate. Matches the three natural decision points in the loop.
        "max_uses": 3,
    }
    return LEAD_TOOLS + [advisor_tool], ["advisor-tool-2026-03-01"]


def _extract_json_string_field_prefix(raw_json: str, field: str) -> str:
    """Best-effort incremental extractor for a JSON string field.

    Used to stream `finalize.result` as it is being generated via
    `input_json_delta` events, before the tool call fully closes.
    """
    key = f'"{field}"'
    key_pos = raw_json.find(key)
    if key_pos < 0:
        return ""

    i = key_pos + len(key)
    n = len(raw_json)

    while i < n and raw_json[i].isspace():
        i += 1
    if i >= n or raw_json[i] != ":":
        return ""
    i += 1

    while i < n and raw_json[i].isspace():
        i += 1
    if i >= n or raw_json[i] != '"':
        return ""
    i += 1

    out: list[str] = []
    escape_map = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    while i < n:
        ch = raw_json[i]
        if ch == '"':
            break
        if ch != "\\":
            out.append(ch)
            i += 1
            continue

        # Escape sequence.
        if i + 1 >= n:
            break
        esc = raw_json[i + 1]
        if esc == "u":
            if i + 5 >= n:
                break
            code = raw_json[i + 2 : i + 6]
            if any(c not in "0123456789abcdefABCDEF" for c in code):
                break
            out.append(chr(int(code, 16)))
            i += 6
            continue

        out.append(escape_map.get(esc, esc))
        i += 2

    return "".join(out)


def _publish_text_delta_smooth(
    bus: SessionEventBus,
    agent_id: str,
    text: str,
    chunk_size: int = 24,
) -> None:
    """Emit text deltas in small chunks to avoid bursty UI jumps."""
    if not text:
        return
    for i in range(0, len(text), chunk_size):
        bus.publish("text_delta", agent_id=agent_id, delta=text[i : i + chunk_size])


async def run_lead(
    session_id: str,
    user_message: str,
    bus: SessionEventBus,
    audience: str = "professional",
    cancel_event: Optional[asyncio.Event] = None,
    attached_document_ids: Optional[list[str]] = None,
) -> str:
    """
    Entry point: run the full Lead agentic loop for one user turn.

    Returns the final answer string. If `cancel_event` is set during the
    run, the loop exits early at its next iteration boundary and a partial
    answer (or a cancellation notice) is persisted so the chat doesn't
    end with a silent empty bubble.
    """
    lead_run_id = await create_agent_run(session_id, "lead_orchestrator")
    bus.publish("agent_spawned", agent_id=lead_run_id, role="lead_orchestrator", parent=None)

    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    use_advisor = bool(ADVISOR_MODEL)
    tools, betas = _build_tools(use_advisor)

    # Load document context. When the user attached a specific subset for
    # this turn, scope the doc index to those docs so we don't pad the prompt
    # with unrelated material — and so the live count_tokens estimate matches
    # what the model actually sees.
    docs = await get_documents(session_id)
    if attached_document_ids:
        attached_set = set(attached_document_ids)
        docs = [d for d in docs if d["id"] in attached_set]
    doc_ids = [d["id"] for d in docs]

    doc_context_parts = []
    for doc in docs:
        chunks = await get_chunks_for_document(doc["id"])
        chunk_lines = []
        for c in chunks[:50]:  # show first 50 chunks as index
            section = f" [§{c['section_id']}]" if c.get("section_id") else ""
            page = f" p.{c['page']}" if c.get("page") else ""
            preview = c["content"][:120].replace("\n", " ")
            chunk_lines.append(f"  chunk_id={c['id']}{section}{page}: {preview}…")
        doc_context_parts.append(
            f"Document: {doc['filename']} ({doc['chunk_count']} chunks)\n"
            + "\n".join(chunk_lines)
        )

    doc_context = "\n\n".join(doc_context_parts) if doc_context_parts else "No documents uploaded yet."

    audience_instruction = _AUDIENCE_INSTRUCTIONS.get(audience, _AUDIENCE_INSTRUCTIONS["professional"])
    audience_finalize_check = _AUDIENCE_FINALIZE_CHECKS.get(
        audience, _AUDIENCE_FINALIZE_CHECKS["professional"]
    )
    system_prompt = _LEAD_SYSTEM.format(
        audience=audience,
        audience_instruction=audience_instruction,
        audience_finalize_check=audience_finalize_check,
    )

    if doc_context_parts:
        initial_user_content = (
            f"## Document Index\n{doc_context}\n\n"
            f"## User Question\n{user_message}"
        )
    else:
        initial_user_content = user_message

    messages: list[dict] = [{"role": "user", "content": initial_user_content}]

    tokens_in = tokens_out = 0
    final_answer = ""
    # Initialised to None so the post-loop recovery block can safely reference
    # it even when the loop breaks before the first API call (e.g. immediate
    # cancellation).
    response: Any = None
    # Track artifacts created this turn so we can backfill a recap if the model
    # calls `finalize` with an empty `result` (safety net only — the system
    # prompt requires a real recap).
    artifacts_this_turn: list[dict] = []

    # Shared kwargs for every API call — switches between beta and standard
    # client depending on whether the advisor tool is active.
    _system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    # Adaptive thinking: Claude decides when/how much to reason based on
    # request complexity. Supported on claude-sonnet-4-6 and claude-opus-4-7.
    # Interleaved thinking is automatically enabled, so Claude can reason
    # between tool calls — ideal for multi-step agentic workflows.
    _thinking: dict | None = (
        {"type": "adaptive"} if MODEL in ("claude-sonnet-4-6", "claude-opus-4-7") else None
    )
    _common: dict = dict(model=MODEL, max_tokens=64000, system=_system, tools=tools)
    if _thinking:
        _common["thinking"] = _thinking
    _stream_fn = (
        lambda **kw: client.beta.messages.stream(**kw, betas=betas)
        if use_advisor
        else client.messages.stream(**kw)
    )

    # Agentic loop
    for _ in range(40):  # safety limit
        # User-initiated cancellation: break before spending another model call.
        if cancel_event is not None and cancel_event.is_set():
            break

        # Check for compaction
        messages, compacted = await maybe_compact(messages, bus)
        if compacted:
            pass  # bus already published compaction_done

        # Cumulative context estimate: persisted session history + the in-flight
        # Lead loop buffer. Persisted history is the source of truth for "how
        # much of the window is committed"; the loop buffer captures live tool
        # results / subagent output that haven't been saved yet. Together they
        # grow monotonically across turns and only dip on compaction — matching
        # what users expect from a context meter.
        persisted = await get_messages(session_id)
        persisted_tokens = _count_tokens_approx(
            [{"role": m["role"], "content": m["content"]} for m in persisted]
        )
        live_tokens = sum(len(str(m)) // 4 for m in messages)
        est_tokens = persisted_tokens + live_tokens
        bus.publish(
            "context_usage",
            tokens=est_tokens,
            window=WINDOW,
            percent=round(est_tokens / WINDOW * 100, 1),
        )

        async with retrying_stream(
            lambda: _stream_fn(**_common, messages=messages)
        ) as stream:
            # Stream thinking and text blocks as they arrive.
            # With adaptive thinking enabled, the model emits thinking blocks
            # (routed to the Thinking panel) and text blocks (inter-tool
            # planning prose, also routed to Thinking — the real user-facing
            # answer is delivered by the `finalize` tool below).
            finalize_block_index: int | None = None
            finalize_input_buffer = ""
            streamed_finalize_prefix = ""
            finalize_thinking_cleared = False
            async for event in stream:
                event_type = getattr(event, "type", None)
                if event_type == "content_block_start":
                    block = getattr(event, "content_block", None)
                    if (
                        finalize_block_index is None
                        and getattr(block, "type", None) == "tool_use"
                        and getattr(block, "name", None) == "finalize"
                    ):
                        idx = getattr(event, "index", None)
                        if isinstance(idx, int):
                            finalize_block_index = idx
                            finalize_input_buffer = ""
                            streamed_finalize_prefix = ""
                elif event_type == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    delta_type = getattr(delta, "type", None)
                    if delta_type == "thinking_delta" and hasattr(delta, "thinking"):
                        bus.publish("thinking_delta", agent_id=lead_run_id, delta=delta.thinking)
                    elif delta_type == "text_delta" and hasattr(delta, "text"):
                        # Between-tool prose is internal planning, not the final answer.
                        bus.publish("thinking_delta", agent_id=lead_run_id, delta=delta.text)
                    elif (
                        delta_type == "input_json_delta"
                        and finalize_block_index is not None
                        and getattr(event, "index", None) == finalize_block_index
                        and hasattr(delta, "partial_json")
                    ):
                        # True token streaming for finalize: decode the partial JSON
                        # as it arrives and forward newly generated suffix only.
                        finalize_input_buffer += delta.partial_json
                        current_prefix = _extract_json_string_field_prefix(
                            finalize_input_buffer, "result"
                        )
                        if len(current_prefix) > len(streamed_finalize_prefix):
                            if not finalize_thinking_cleared:
                                bus.publish("thinking_clear", agent_id=lead_run_id)
                                finalize_thinking_cleared = True
                            new_suffix = current_prefix[len(streamed_finalize_prefix):]
                            _publish_text_delta_smooth(bus, lead_run_id, new_suffix)
                            streamed_finalize_prefix = current_prefix
            response = await stream.get_final_message()

        tokens_in += response.usage.input_tokens
        tokens_out += response.usage.output_tokens

        # Accumulate advisor token usage (billed separately at advisor model rates).
        # `iterations` is not in the typed SDK schema yet — access via getattr.
        if use_advisor:
            for iteration in getattr(response.usage, "iterations", None) or []:
                if getattr(iteration, "type", None) == "advisor_message":
                    tokens_in += getattr(iteration, "input_tokens", 0)
                    tokens_out += getattr(iteration, "output_tokens", 0)

        if response.stop_reason == "end_turn":
            for block in response.content:
                if block.type == "text":
                    final_answer += block.text
            final_answer = normalize_chunk_citation_syntax(final_answer)
            if final_answer:
                bus.publish("thinking_clear", agent_id=lead_run_id)
                # Note: final_answer was already streamed incrementally via text_delta
                # during the input_json_delta phase (lines 474-487). Publishing
                # final_message here provides the canonical full text to the frontend.
                bus.publish("final_message", content=final_answer)
                bus.publish("run_complete", final=final_answer[:300])
                await finish_agent_run(lead_run_id, tokens_in, tokens_out)
                await add_message(
                    session_id,
                    "assistant",
                    final_answer,
                    tokens_in + tokens_out,
                    artifact_ids=[
                        a["artifact_id"] for a in artifacts_this_turn if a.get("artifact_id")
                    ],
                    thinking=bus.drain_thinking() or None,
                )
                return final_answer
            break

        if response.stop_reason != "tool_use":
            break

        # ── Surface advisor guidance into the thinking panel ─────────────
        # When the advisor tool fires, its result arrives as an
        # `advisor_tool_result` block in response.content. The stream pauses
        # silently during advisor sub-inference (no deltas), so we emit the
        # advisor's text as a thinking_delta here so the user sees it.
        if use_advisor:
            for block in response.content:
                if getattr(block, "type", None) == "advisor_tool_result":
                    advisor_content = getattr(block, "content", None)
                    advisor_text = getattr(advisor_content, "text", None) if advisor_content else None
                    if advisor_text:
                        bus.publish(
                            "thinking_delta",
                            agent_id=lead_run_id,
                            delta=f"\n\n[Advisor] {advisor_text}",
                        )

        # ── Handle tool calls ─────────────────────────────────────────────
        # Collect spawn_subagent calls to run in parallel
        spawn_calls: list[dict] = []
        other_tool_results: list[dict] = []

        for block in response.content:
            if block.type != "tool_use":
                continue

            bus.publish(
                "tool_use",
                agent_id=lead_run_id,
                tool=block.name,
                input=block.input,
            )

            if block.name == "spawn_subagent":
                spawn_calls.append({"block_id": block.id, "input": block.input})

            elif block.name == "finalize":
                final_answer = normalize_chunk_citation_syntax(block.input.get("result") or "")
                # Safety net: if the model called write_artifact this turn but
                # left `result` empty or trivially short (< ~25 words), backfill
                # a minimal message pointing at the artifact(s). The system
                # prompt requires a full recap; this just prevents a silent UI.
                if artifacts_this_turn and len(final_answer.strip()) < 500:
                    names = ", ".join(a["name"] for a in artifacts_this_turn if a.get("name"))
                    fallback = (
                        f"I've prepared a detailed write-up in the generated file"
                        f"{'s' if len(artifacts_this_turn) > 1 else ''}"
                        f"{': ' + names if names else '.'} Open it above for the full breakdown, "
                        f"and let me know if you'd like me to dig deeper into any specific section."
                    )
                    final_answer = final_answer or fallback
                # `finalize.result` is streamed during input_json_delta handling
                # above. Here we only reconcile any tail that wasn't emitted
                # incrementally (e.g. parser boundary edge cases / fallbacks).
                if not finalize_thinking_cleared:
                    bus.publish("thinking_clear", agent_id=lead_run_id)
                    finalize_thinking_cleared = True
                if final_answer.startswith(streamed_finalize_prefix):
                    remainder = final_answer[len(streamed_finalize_prefix):]
                else:
                    # Parser drift safeguard: if incremental decode diverged,
                    # avoid duplicating incorrect deltas and rely on
                    # final_message for canonical content.
                    remainder = ""
                if remainder:
                    _publish_text_delta_smooth(bus, lead_run_id, remainder)
                bus.publish("final_message", content=final_answer)
                bus.publish("run_complete", final=final_answer[:300])
                await finish_agent_run(lead_run_id, tokens_in, tokens_out)
                await add_message(
                    session_id,
                    "assistant",
                    final_answer,
                    tokens_in + tokens_out,
                    artifact_ids=[
                        a["artifact_id"] for a in artifacts_this_turn if a.get("artifact_id")
                    ],
                    thinking=bus.drain_thinking() or None,
                )
                return final_answer

            else:
                result = await handle_tool(block.name, block.input, session_id, doc_ids)
                if block.name == "write_artifact":
                    artifacts_this_turn.append({
                        "artifact_id": result.get("artifact_id"),
                        "name": result.get("name"),
                    })
                    bus.publish(
                        "artifact_written",
                        artifact_id=result.get("artifact_id"),
                        name=result.get("name"),
                    )
                other_tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

        # Run subagents in parallel
        subagent_results: list[dict] = []
        if spawn_calls:
            tasks = [
                run_subagent(
                    role=call["input"]["role"],
                    task=call["input"]["task"],
                    chunk_ids=call["input"].get("chunk_ids", []),
                    session_id=session_id,
                    bus=bus,
                    audience=audience,
                    parent_agent_id=lead_run_id,
                )
                for call in spawn_calls
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for call, result in zip(spawn_calls, results):
                if isinstance(result, Exception):
                    result_content = json.dumps({"error": str(result)})
                else:
                    r = cast(dict[str, Any], result)  # narrow away BaseException for type checker
                    subagent_results.append(r)
                    # Build a single note that covers both failure modes so the
                    # Lead receives a clear, actionable signal for re-spawning.
                    notes: list[str] = []
                    if not r["citations_present"]:
                        notes.append("WARNING: no citations found — re-spawn this task")
                    if not r["citations_valid"]:
                        bad = ", ".join(r["invalid_citation_ids"])
                        notes.append(
                            f"WARNING: {len(r['invalid_citation_ids'])} hallucinated "
                            f"chunk ID(s) detected ({bad}) — these UUIDs do not exist in "
                            "the database; do not trust this result, re-spawn the task"
                        )
                    result_content = json.dumps({
                        "agent_id": r["agent_id"],
                        "result": r["result_text"],
                        "citations_present": r["citations_present"],
                        "citations_valid": r["citations_valid"],
                        "note": " | ".join(notes) if notes else "",
                    })

                other_tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": call["block_id"],
                    "content": result_content,
                })

        # Append assistant turn + tool results
        messages.append({"role": "assistant", "content": response.content})
        if other_tool_results:
            messages.append({"role": "user", "content": other_tool_results})

    # ── Loop exited without `finalize` ───────────────────────────────────
    # Three recovery tiers, in priority order:
    #   1. Scrape any text blocks from the last response (model ended with
    #      a text answer but forgot to call finalize).
    #   2. If artifacts were produced this turn, backfill a readable recap
    #      pointing the user at them so the UI never shows an empty bubble.
    #   3. Last resort: honest error message. Never persist an empty string.
    # Check block.type explicitly — beta response content includes non-text
    # block types (server_tool_use, advisor_tool_result, etc.) that don't
    # carry a .text attribute.
    if not final_answer:
        for block in response.content if response else []:
            if getattr(block, "type", None) == "text":
                final_answer += block.text
        final_answer = normalize_chunk_citation_syntax(final_answer.strip())

    if not final_answer and artifacts_this_turn:
        # Same shape as the `finalize`-branch fallback, but worded to reflect
        # that the model skipped the recap entirely rather than providing a
        # thin one. This branch fires when the loop runs out of iterations or
        # the model returns tool_use without ever calling finalize.
        names = ", ".join(a["name"] for a in artifacts_this_turn if a.get("name"))
        plural = "s" if len(artifacts_this_turn) > 1 else ""
        final_answer = (
            f"I've prepared the requested write-up in the generated file{plural}"
            f"{': ' + names if names else '.'} "
            f"Open {'them' if plural else 'it'} above to see the full breakdown. "
            f"Ask a follow-up question if you'd like me to expand on any section "
            f"or walk through specific findings in more detail."
        )

    cancelled = cancel_event is not None and cancel_event.is_set()

    if not final_answer and cancelled:
        # User clicked Stop. Persist a clear, non-error message so the chat
        # bubble is meaningful and the run state ends cleanly.
        final_answer = (
            "Run stopped before a final answer was produced. "
            "Click Retry on the previous message to run it again."
        )

    if not final_answer:
        # No text, no artifacts — the run truly produced nothing user-visible.
        # Tell the user explicitly rather than silently persisting an empty
        # bubble they have to refresh to notice.
        final_answer = (
            "I wasn't able to produce a final answer for this turn — the agents "
            "ran but didn't return a response. Please try rephrasing your "
            "question, or click Retry on this message to run it again."
        )

    bus.publish("final_message", content=final_answer)
    bus.publish("run_complete", final=final_answer[:300])
    await finish_agent_run(lead_run_id, tokens_in, tokens_out)
    await add_message(
        session_id,
        "assistant",
        final_answer,
        tokens_in + tokens_out,
        artifact_ids=[
            a["artifact_id"] for a in artifacts_this_turn if a.get("artifact_id")
        ],
        thinking=bus.drain_thinking() or None,
    )

    return final_answer
