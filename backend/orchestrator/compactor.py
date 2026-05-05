"""
Lead-context compactor.

When the Lead's conversation history exceeds ~70% of the 200K context window
(≈140K tokens), this module condenses earlier turns into a structured memory
summary so the agentic loop can continue without hitting limits.

Auto-trigger threshold: 85% (170K tokens).
"""

from __future__ import annotations

import os
from typing import Any

import anthropic

from backend.orchestrator.rate_limit import with_retry

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
WINDOW = 200_000
COMPACT_THRESHOLD = 0.85  # trigger at 85%
TARGET_AFTER = 0.20       # aim to reduce to ~20% after compaction

_COMPACT_PROMPT = """You are a context compactor for a multi-agent document analysis session.

Below are earlier turns of the Lead Orchestrator's conversation.
Produce a dense, structured summary that preserves:
1. All tool calls and their outcomes (chunk IDs fetched, search results found, definitions resolved)
2. All subagent spawns: their roles, tasks, and key results with citations
3. All artifacts written (name, artifact_id, key findings)
4. The overall progress toward answering the user's question
5. Any open questions or pending tasks

Format as a numbered list of events. Be concise but complete — nothing important should be lost.
"""


def _count_tokens_approx(messages: list[dict]) -> int:
    """Very rough token count: ~4 chars per token.

    The block loop must NOT gate on `isinstance(block, dict)` — when the
    Lead loop appends `response.content`, the blocks are SDK objects (e.g.
    BetaContentBlock), not dicts. Gating on dict skipped them entirely and
    caused the compaction trigger to fire late on tool-heavy turns.
    """
    total = 0
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, str):
            total += len(content) // 4
        elif isinstance(content, list):
            for block in content:
                total += len(str(block)) // 4
    return total


async def maybe_compact(
    messages: list[dict],
    bus: Any,  # SessionEventBus
) -> tuple[list[dict], bool]:
    """
    Check if compaction is needed; if so, compact and return the new message list.

    Returns (new_messages, compacted: bool).
    """
    token_est = _count_tokens_approx(messages)
    if token_est < WINDOW * COMPACT_THRESHOLD:
        return messages, False

    bus.publish(
        "context_usage",
        tokens=token_est,
        window=WINDOW,
        percent=round(token_est / WINDOW * 100, 1),
    )

    # Keep the last N messages as-is; compact everything before
    keep_tail = max(4, len(messages) // 5)
    to_compact = messages[:-keep_tail]
    tail = messages[-keep_tail:]

    # Truncate non-string content (tool results, SDK block lists) at 4K chars
    # rather than 500. The smaller cap was dropping the bulk of subagent
    # findings and chunk content from the summary, causing the Lead to
    # re-fetch material it had already gathered.
    _BLOCK_CAP = 4000
    history_text = "\n\n".join(
        f"[{m['role'].upper()}]: {m['content'] if isinstance(m['content'], str) else str(m['content'])[:_BLOCK_CAP]}"
        for m in to_compact
    )

    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    resp = await with_retry(
        lambda: client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=_COMPACT_PROMPT,
            messages=[{"role": "user", "content": history_text}],
        )
    )
    summary = resp.content[0].text if resp.content else "(empty summary)"

    before_tokens = token_est
    new_messages = [
        {
            "role": "user",
            "content": f"[COMPACTED SESSION HISTORY]\n{summary}",
        },
        {"role": "assistant", "content": "Understood. Continuing from the compacted history."},
        *tail,
    ]
    after_tokens = _count_tokens_approx(new_messages)

    bus.publish(
        "compaction_done",
        before_tokens=before_tokens,
        after_tokens=after_tokens,
    )

    return new_messages, True
