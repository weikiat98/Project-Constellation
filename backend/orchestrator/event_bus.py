"""
In-process pub/sub EventBus for SSE streaming.

Each session gets its own queue.  The FastAPI /stream endpoint consumes events;
the orchestrator publishes them.

Trace persistence: each bus carries an optional (session_id, run_index) so
trace-relevant events can be persisted to SQLite and replayed when the user
re-opens the session.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator, Optional

_SENTINEL = object()  # signals stream end

# Event types worth persisting as trace history.
_PERSIST_TYPES = {
    "agent_spawned",
    "tool_use",
    "artifact_written",
    "agent_done",
    "compaction_done",
}


class SessionEventBus:
    """A simple asyncio.Queue-backed event bus for one session."""

    def __init__(
        self,
        session_id: Optional[str] = None,
        run_index: Optional[int] = None,
    ) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._session_id = session_id
        self._run_index = run_index
        self._seq = 0
        # Running buffer of all thinking_delta text for the current run, so the
        # lead can persist it onto the assistant message when the run finishes.
        self._thinking_buffer: list[str] = []

    def bind_persistence(self, session_id: str, run_index: int) -> None:
        """Attach a session/run so persisted events land in the right bucket."""
        self._session_id = session_id
        self._run_index = run_index
        self._seq = 0

    def publish(self, event_type: str, **data: Any) -> None:
        """Non-blocking publish — safe to call from sync or async code."""
        if self._closed:
            return
        payload = {"type": event_type, **data}
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # drop if consumer is too slow

        # Mirror thinking deltas into a buffer so the orchestrator can persist
        # the full reasoning stream with the assistant message. `thinking_clear`
        # drops what's accumulated (model ended turn without `finalize`).
        if event_type == "thinking_delta":
            delta = data.get("delta")
            if isinstance(delta, str):
                self._thinking_buffer.append(delta)
        elif event_type == "thinking_clear":
            self._thinking_buffer.clear()

        # Persist trace-relevant events so they survive reloads.
        if (
            self._session_id is not None
            and self._run_index is not None
            and event_type in _PERSIST_TYPES
        ):
            seq = self._seq
            self._seq += 1
            asyncio.create_task(
                _persist_event(self._session_id, self._run_index, seq, event_type, data)
            )

    def close(self) -> None:
        """Signal end-of-stream."""
        if self._closed:
            return
        self._closed = True
        try:
            self._queue.put_nowait(_SENTINEL)
        except asyncio.QueueFull:
            pass

    @property
    def closed(self) -> bool:
        return self._closed

    def drain_thinking(self) -> str:
        """Return the accumulated thinking text and clear the buffer."""
        text = "".join(self._thinking_buffer)
        self._thinking_buffer.clear()
        return text

    async def consume(self) -> AsyncGenerator[str, None]:
        """Async generator yielding SSE-formatted strings."""
        while True:
            item = await self._queue.get()
            if item is _SENTINEL:
                return
            yield f"data: {json.dumps(item)}\n\n"


async def _persist_event(
    session_id: str, run_index: int, seq: int, event_type: str, payload: dict
) -> None:
    # Imported lazily to avoid a circular import on module load.
    from backend.store.sessions import append_trace_event

    try:
        await append_trace_event(session_id, run_index, seq, event_type, payload)
    except Exception:
        # Trace persistence is best-effort — don't crash the run if it fails.
        pass


class EventBusRegistry:
    """Process-wide registry of per-session event buses."""

    def __init__(self) -> None:
        self._buses: dict[str, SessionEventBus] = {}

    def get_or_create(self, session_id: str) -> SessionEventBus:
        bus = self._buses.get(session_id)
        if bus is None:
            bus = SessionEventBus()
            self._buses[session_id] = bus
        return bus

    def ensure_live(self, session_id: str) -> SessionEventBus:
        """Return an open bus for a new run; replace any closed one."""
        bus = self._buses.get(session_id)
        if bus is None or bus.closed:
            bus = SessionEventBus()
            self._buses[session_id] = bus
        return bus

    def close(self, session_id: str) -> None:
        bus = self._buses.get(session_id)
        if bus:
            bus.close()


# Module-level singleton
event_registry = EventBusRegistry()
