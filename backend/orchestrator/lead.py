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
    add_message,
    create_agent_run,
    finish_agent_run,
)
from backend.orchestrator.tools import LEAD_TOOLS, handle_tool
from backend.orchestrator.subagent import run_subagent
from backend.orchestrator.compactor import maybe_compact
from backend.orchestrator.event_bus import SessionEventBus

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6")
WINDOW = 200_000

_LEAD_SYSTEM = """You are the Lead Orchestrator of a multi-agent deep-reading assistant.

Your job is to answer the user's question about an uploaded document with maximum
accuracy, depth, and citation fidelity.

## Workflow
1. Use search_document or read_document_chunk to understand the document structure.
2. Spawn specialised subagents (spawn_subagent) for focused subtasks — one subagent
   per logical unit of work. Run independent tasks in parallel by spawning multiple
   subagents in a single response.
3. Every subagent result contains citations in [chunk_id] format. Validate them.
4. Synthesize results. Write structured artifacts with write_artifact when appropriate.
5. Call finalize with the complete, cited answer.

## Citation rule
Every factual claim in your final answer MUST include a [chunk_id] citation.
Reject any subagent output that lacks citations — re-spawn the task.

## Audience: {audience}
{audience_instruction}

## Context window
You have ~200K tokens. If you see a compacted history, trust it and continue.
"""

_AUDIENCE_INSTRUCTIONS = {
    "layperson": "Explain everything in plain, everyday language. No jargon.",
    "professional": "Use domain-appropriate terminology. Assume professional familiarity.",
    "expert": "Use precise technical/legal language. Include full section references.",
}


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
        audience=audience, audience_instruction=audience_instruction
    )

    initial_user_content = (
        f"## Document Index\n{doc_context}\n\n"
        f"## User Question\n{user_message}"
    )

    messages: list[dict] = [{"role": "user", "content": initial_user_content}]

    tokens_in = tokens_out = 0
    final_answer = ""

    # Agentic loop
    for _iteration in range(40):  # safety limit
        # Check for compaction
        messages, compacted = await maybe_compact(messages, bus)
        if compacted:
            pass  # bus already published compaction_done

        # Current token estimate
        est_tokens = sum(len(str(m)) // 4 for m in messages)
        bus.publish(
            "context_usage",
            tokens=est_tokens,
            window=WINDOW,
            percent=round(est_tokens / WINDOW * 100, 1),
        )

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
            tools=LEAD_TOOLS,
            messages=messages,
        )

        tokens_in += response.usage.input_tokens
        tokens_out += response.usage.output_tokens

        # Stream text deltas
        for block in response.content:
            if block.type == "text":
                bus.publish("text_delta", agent_id=lead_run_id, delta=block.text)

        if response.stop_reason == "end_turn":
            # Collect any text content as the final answer
            for block in response.content:
                if block.type == "text":
                    final_answer += block.text
            break

        if response.stop_reason != "tool_use":
            break

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
                final_answer = block.input.get("result", "")
                bus.publish("run_complete", final=final_answer[:300])
                await finish_agent_run(lead_run_id, tokens_in, tokens_out)
                await add_message(session_id, "assistant", final_answer, tokens_in + tokens_out)
                return final_answer

            else:
                result = await handle_tool(block.name, block.input, session_id, doc_ids)
                if block.name == "write_artifact":
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

    # If we exited the loop without finalize, use last text as answer
    if not final_answer:
        for block in response.content if response else []:
            if hasattr(block, "text"):
                final_answer += block.text

    bus.publish("run_complete", final=final_answer[:300])
    await finish_agent_run(lead_run_id, tokens_in, tokens_out)
    await add_message(session_id, "assistant", final_answer, tokens_in + tokens_out)

    return final_answer
