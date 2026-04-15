"""
SubAgent runner.

Each subagent is a fresh async Messages call with:
  - A cached system prompt (role description + citation enforcement)
  - Only the chunk IDs it needs as context
  - Its own tool set (read_document_chunk only)

Citation enforcement: the Lead's tool handler validates that every subagent
result contains at least one [chunk_id] citation; if not, it logs a warning
and the Lead can choose to respawn.
"""

from __future__ import annotations

import os
import re
import uuid
from typing import Any, Optional

import anthropic

from backend.store.sessions import get_chunk, finish_agent_run, create_agent_run
from backend.orchestrator.event_bus import SessionEventBus

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

_CITATION_RE = re.compile(r'\[[0-9a-f\-]{36}\]')

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


def _make_system_prompt(role: str, audience: str) -> str:
    audience_instruction = {
        "layperson": (
            "Explain findings in plain, everyday language. Avoid jargon. "
            "Use short sentences and simple vocabulary."
        ),
        "professional": (
            "Use domain-appropriate terminology. Assume the reader has professional "
            "familiarity with the subject matter."
        ),
        "expert": (
            "Use precise technical/legal language. Include full section references. "
            "Assume expert-level background knowledge."
        ),
    }.get(audience, "Use domain-appropriate terminology.")

    return f"""You are a specialised document analysis subagent.

ROLE: {role}

AUDIENCE LEVEL: {audience_instruction}

CITATION RULE (MANDATORY):
Every factual claim you make MUST include a citation in the form [chunk_id] where
chunk_id is the UUID of the chunk it came from. Example:
  "The penalty for non-compliance is $50,000 [3f8a1b2c-...]."
Claims without citations will be rejected.

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
    run_id = await create_agent_run(session_id, role[:100], parent_agent_id)

    bus.publish("agent_spawned", agent_id=agent_id, role=role[:120], parent=parent_agent_id or "lead")

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

    system_prompt = _make_system_prompt(role, audience)

    # Agentic loop
    for _iteration in range(20):  # safety limit
        response = await client.messages.create(
            model=MODEL,
            max_tokens=8192,
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

        tokens_in += response.usage.input_tokens
        tokens_out += response.usage.output_tokens

        # Stream text deltas to bus
        for block in response.content:
            if block.type == "text":
                bus.publish("text_delta", agent_id=agent_id, delta=block.text)
                result_text += block.text
            elif block.type == "tool_use":
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

    citations_present = bool(_CITATION_RE.search(result_text))

    bus.publish("agent_done", agent_id=agent_id, summary=result_text[:200])

    await finish_agent_run(run_id, tokens_in, tokens_out)

    return {
        "agent_id": agent_id,
        "result_text": result_text,
        "citations_present": citations_present,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
