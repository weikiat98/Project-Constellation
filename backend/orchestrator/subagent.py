"""
SubAgent runner.

Each subagent is a fresh async Messages call with:
  - A cached system prompt (role description + citation enforcement)
  - Only the chunk IDs it needs as context
  - Its own tool set (read_document_chunk only)

Citation enforcement: two checks are applied to every subagent result before
it is returned to the Lead:
  1. Presence check  — at least one [chunk_id] token exists (regex).
  2. Validity check  — every cited UUID is looked up in the DB; any UUID that
     does not exist is treated as a hallucination and sets citations_valid=False.
Both flags are surfaced to the Lead so it can decide to re-spawn the task.

Vocabulary restriction: the subagent system prompt explicitly lists the valid
chunk IDs it was given and instructs the model to only cite from that list,
reducing the opportunity for the model to invent plausible-looking UUIDs.
"""

from __future__ import annotations

import os
import re
import uuid
from typing import Any, Optional

import anthropic

from backend.store.sessions import get_chunk, finish_agent_run, create_agent_run
from backend.orchestrator.event_bus import SessionEventBus
from backend.orchestrator.rate_limit import retrying_stream

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

_CITATION_RE = re.compile(r'\[[0-9a-fA-F\-]{36}\]')

_SUBAGENT_TOOLS = [
    {
        "name": "read_document_chunk",
        "description": "Fetch the full text of a document chunk by its chunk ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "chunk_id": {"type": "string", "description": "UUID of the chunk."}
            },
            "required": ["chunk_id"],
        },
    }
]


def _make_system_prompt(role: str, audience: str, valid_chunk_ids: list[str]) -> str:
    audience_instruction = {
        "layperson": (
            "TARGET READER: A non-expert with no background in this domain.\n"
            "FORBIDDEN: Latin terms, statute/section numbers, unexpanded acronyms, "
            "jargon, hedged legal verbs ('shall', 'whereby').\n"
            "REQUIRED: Short sentences (≤20 words). Concrete nouns. Everyday verbs. "
            "If you must mention a technical concept, paraphrase it first.\n"
            "EXAMPLE: ❌ 'The lessee shall remit consideration quarterly.' "
            "✅ 'The tenant has to pay rent every three months.'\n"
            "Citations [chunk_id] are still mandatory — only the prose changes."
        ),
        "professional": (
            "TARGET READER: A working professional with domain familiarity "
            "(junior lawyer, analyst, PM).\n"
            "REQUIRED: Domain terminology used correctly; acronyms expanded on first "
            "use; section references where they aid navigation.\n"
            "AVOID: Both dumbed-down chat and dense expert-only Latin.\n"
            "EXAMPLE: ✅ 'The lease requires quarterly rent payments (Section 12(3)(a)). "
            "Late payment triggers the default-interest clause.'"
        ),
        "expert": (
            "TARGET READER: A subject-matter expert (counsel, senior analyst).\n"
            "REQUIRED: Full statutory / clause references in canonical form. "
            "Domain Latin where it carries specific meaning. Distinguish operative "
            "vs. interpretive provisions. Use the document's defined terms verbatim.\n"
            "AVOID: Paraphrasing defined terms; layperson-friendly restatements.\n"
            "EXAMPLE: ✅ 'Section 12(3)(a) imposes a quarterly rent obligation on the "
            "Lessee, subject to the default-interest mechanism in Section 18(2).'"
        ),
    }.get(audience, "Use domain-appropriate terminology.")

    valid_ids_block = "\n".join(f"  - {cid}" for cid in valid_chunk_ids)

    return f"""You are a specialised document analysis subagent.

ROLE: {role}

AUDIENCE LEVEL: {audience_instruction}

CITATION RULE (MANDATORY):
Every factual claim you make MUST include a citation in the form [chunk_id] where
chunk_id is the UUID of the chunk it came from. Example:
  "The penalty for non-compliance is $50,000 [3f8a1b2c-...]."
Claims without citations will be rejected.

VALID CHUNK IDs FOR THIS TASK (cite ONLY from this list — do not invent or infer chunk IDs):
{valid_ids_block}

Use the read_document_chunk tool to fetch any chunk you need.
Be thorough, precise, and cite every claim."""


async def run_subagent(
    role: str,
    task: str,
    chunk_ids: list[str],
    session_id: str,
    bus: SessionEventBus,
    audience: str = "professional",
    parent_agent_id: Optional[str] = None,
) -> dict[str, Any]:
    """
    Run a single subagent and return its result.

    Returns: {agent_id, result_text, citations_present, tokens_in, tokens_out}
    """
    agent_id = str(uuid.uuid4())
    # Extract first sentence only for display (split on '. ')
    role_display = role.split(". ")[0] if ". " in role else role
    run_id = await create_agent_run(session_id, role_display, parent_agent_id)

    bus.publish("agent_spawned", agent_id=agent_id, role=role_display, parent=parent_agent_id or "lead")

    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    # Build context: include chunk previews so the agent knows what's available
    chunk_list_lines = []
    for cid in chunk_ids:
        chunk = await get_chunk(cid)
        if chunk:
            preview = chunk["content"][:200].replace("\n", " ")
            section = f" [§{chunk['section_id']}]" if chunk.get("section_id") else ""
            page = f" p.{chunk['page']}" if chunk.get("page") else ""
            chunk_list_lines.append(f"- chunk_id={cid}{section}{page}: {preview}…")

    chunk_index = "\n".join(chunk_list_lines) if chunk_list_lines else "(none provided)"

    user_message = (
        f"Available chunks for this task:\n{chunk_index}\n\n"
        f"Task: {task}\n\n"
        "Use read_document_chunk to fetch any chunk you need. "
        "Cite every factual claim with [chunk_id]."
    )

    messages: list[dict] = [{"role": "user", "content": user_message}]
    tokens_in = tokens_out = 0
    result_text = ""

    system_prompt = _make_system_prompt(role, audience, chunk_ids)

    # Agentic loop
    for _iteration in range(20):  # safety limit
        async with retrying_stream(
            lambda: client.messages.stream(
                model=MODEL,
                max_tokens=10000,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=_SUBAGENT_TOOLS,
                messages=messages,
            )
        ) as stream:
            # Subagent output is internal reasoning — the Lead consumes
            # `result_text` via the subagent's return value, not the chat
            # stream. Publish as `thinking_delta` so the UI shows it only in
            # the collapsible thinking panel.
            async for text_chunk in stream.text_stream:
                bus.publish("thinking_delta", agent_id=agent_id, delta=text_chunk)
                result_text += text_chunk
            response = await stream.get_final_message()

        tokens_in += response.usage.input_tokens
        tokens_out += response.usage.output_tokens

        # Emit tool_use events for any tool calls in the final message
        for block in response.content:
            if block.type == "tool_use":
                bus.publish(
                    "tool_use",
                    agent_id=agent_id,
                    tool=block.name,
                    input=block.input,
                )

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason == "tool_use":
            # Handle tool calls
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                if block.name == "read_document_chunk":
                    chunk = await get_chunk(block.input.get("chunk_id", ""))
                    if chunk:
                        tool_result = {
                            "chunk_id": chunk["id"],
                            "content": chunk["content"],
                            "section_id": chunk.get("section_id"),
                            "page": chunk.get("page"),
                        }
                    else:
                        tool_result = {"error": "Chunk not found."}
                else:
                    tool_result = {"error": f"Unknown tool: {block.name}"}

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(tool_result),
                })

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        else:
            break

    # ── Citation validation ───────────────────────────────────────────────
    # Check 1: presence — at least one UUID-shaped token exists.
    citations_present = bool(_CITATION_RE.search(result_text))

    # Check 2: validity — every cited UUID must exist in the database.
    # A UUID that passes the regex but returns None from get_chunk is a
    # hallucination (the model invented or misremembered a chunk ID).
    cited_ids = [m[1:-1] for m in _CITATION_RE.findall(result_text)]  # strip [ ]
    invalid_ids: list[str] = []
    for cid in cited_ids:
        if await get_chunk(cid) is None:
            invalid_ids.append(cid)
    citations_valid = len(invalid_ids) == 0

    # Send up to 2KB of subagent output. The trace UI lets the user expand
    # this on click; truncating at 200 was hiding nearly all of the actual
    # findings. Append an ellipsis if we did truncate so the UI can hint at it.
    summary = result_text if len(result_text) <= 2000 else result_text[:2000] + "…"
    bus.publish("agent_done", agent_id=agent_id, summary=summary)

    await finish_agent_run(run_id, tokens_in, tokens_out)

    return {
        "agent_id": agent_id,
        "result_text": result_text,
        "citations_present": citations_present,
        "citations_valid": citations_valid,
        "invalid_citation_ids": invalid_ids,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
