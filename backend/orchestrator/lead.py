"""
LeadOrchestrator — async orchestrator-workers pattern.

The Lead runs an agentic tool-use loop.  When it calls spawn_subagent,
all spawns are gathered in parallel via asyncio.gather.  The Lead then
synthesizes the results and either calls finalize or continues with more tools.

Citation enforcement: subagent results missing [chunk_id] citations are flagged
and the Lead is informed so it can respawn or adjust.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

import anthropic

from backend.store.sessions import (
    get_documents,
    get_chunks_for_document,
    get_messages,
    add_message,
    create_agent_run,
    finish_agent_run,
)
from backend.orchestrator.tools import LEAD_TOOLS, handle_tool
from backend.orchestrator.subagent import run_subagent
from backend.orchestrator.compactor import maybe_compact, _count_tokens_approx
from backend.orchestrator.event_bus import SessionEventBus

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001") # change to claude-opus-4-6 for production and use claude-haiku-4-5-20251001 for testing
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
- Use bullet lists (`-`) for unordered items and numbered lists (`1.`) for sequential steps
- Use **bold** for key terms or labels
Apply formatting for both document-based answers and plain text message responses.

## Citation rule
When documents are uploaded, every factual claim drawn from them MUST include a
[chunk_id] citation. Reject any subagent output that lacks citations — re-spawn the task.
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
        "(15–30 words). Light structure (bold labels, short bullets) when it helps.\n\n"
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


_AUDIENCE_FINALIZE_CHECK = (
    "BEFORE calling `finalize`, re-read your `result` against the AUDIENCE brief "
    "above. If audience=layperson and you used a section number, Latin term, or "
    "unexpanded acronym, REWRITE that sentence in plain English. If audience=expert "
    "and you wrote a generic word like 'rule' or 'clause' instead of the precise "
    "statutory reference, REWRITE it. Audience compliance is non-negotiable."
)


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


async def run_lead(
    session_id: str,
    user_message: str,
    bus: SessionEventBus,
    audience: str = "professional",
) -> str:
    """
    Entry point: run the full Lead agentic loop for one user turn.

    Returns the final answer string.
    """
    lead_run_id = await create_agent_run(session_id, "lead_orchestrator")
    bus.publish("agent_spawned", agent_id=lead_run_id, role="lead_orchestrator", parent=None)

    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    use_advisor = bool(ADVISOR_MODEL)
    tools, betas = _build_tools(use_advisor)

    # Load document context
    docs = await get_documents(session_id)
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
    system_prompt = _LEAD_SYSTEM.format(
        audience=audience,
        audience_instruction=audience_instruction,
        audience_finalize_check=_AUDIENCE_FINALIZE_CHECK,
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
    # Track artifacts created this turn so we can backfill a recap if the model
    # calls `finalize` with an empty `result` (safety net only — the system
    # prompt requires a real recap).
    artifacts_this_turn: list[dict] = []

    # Shared kwargs for every API call — switches between beta and standard
    # client depending on whether the advisor tool is active.
    _system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    _common: dict = dict(model=MODEL, max_tokens=64000, system=_system, tools=tools)
    _stream_fn = (
        lambda **kw: client.beta.messages.stream(**kw, betas=betas)
        if use_advisor
        else client.messages.stream(**kw)
    )

    # Agentic loop
    for _ in range(40):  # safety limit
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

        async with _stream_fn(**_common, messages=messages) as stream:
            # Lead prose between tool calls is planning/reasoning, not the
            # user-facing answer — stream it as `thinking_delta` so the UI can
            # route it into a separate "Thinking…" panel. The actual chat
            # message is delivered via the `finalize` tool below.
            async for text_chunk in stream.text_stream:
                bus.publish("thinking_delta", agent_id=lead_run_id, delta=text_chunk)
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
            # The model ended the turn with plain text instead of calling
            # `finalize` (e.g. a refusal or chat-style response). That same
            # text was already streamed as `thinking_delta` above, so clear
            # the thinking panel before we re-emit the text as the real
            # user-facing message — otherwise it appears in both places.
            for block in response.content:
                if block.type == "text":
                    final_answer += block.text
            if final_answer:
                bus.publish("thinking_clear", agent_id=lead_run_id)
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
                final_answer = (block.input.get("result") or "").strip()
                # Safety net: if the model called write_artifact this turn but
                # left `result` empty or trivially short (< ~25 words), backfill
                # a minimal message pointing at the artifact(s). The system
                # prompt requires a full recap; this just prevents a silent UI.
                if artifacts_this_turn and len(final_answer) < 500:
                    names = ", ".join(a["name"] for a in artifacts_this_turn if a.get("name"))
                    fallback = (
                        f"I've prepared a detailed write-up in the generated file"
                        f"{'s' if len(artifacts_this_turn) > 1 else ''}"
                        f"{': ' + names if names else '.'} Open it above for the full breakdown, "
                        f"and let me know if you'd like me to dig deeper into any specific section."
                    )
                    final_answer = final_answer or fallback
                # Clear any streamed thinking prose so the final answer isn't
                # duplicated in the thinking panel when we stream it below.
                bus.publish("thinking_clear", agent_id=lead_run_id)
                # Emit the final answer as a single event. The client-side
                # typewriter in ChatPane animates the reveal — chunking on the
                # server as well made the two mechanisms fight each other and
                # collapsed the animation to an instant snap.
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
                    subagent_results.append(result)
                    citation_note = "" if result["citations_present"] else " [WARNING: no citations found]"
                    result_content = json.dumps({
                        "agent_id": result["agent_id"],
                        "result": result["result_text"],
                        "citations_present": result["citations_present"],
                        "note": citation_note,
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
        final_answer = final_answer.strip()

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
