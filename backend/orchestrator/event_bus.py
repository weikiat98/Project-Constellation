"""
In-process pub/sub EventBus for SSE streaming.

Each session gets its own queue.  The FastAPI /stream endpoint consumes events;
the orchestrator publishes them.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

_SENTINEL = object()  # signals stream end


class SessionEventBus:
    """A simple asyncio.Queue-backed event bus for one session."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()

    def publish(self, event_type: str, **data: Any) -> None:
        """Non-blocking publish — safe to call from sync or async code."""
        payload = {"type": event_type, **data}
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # drop if consumer is too slow

    def close(self) -> None:
        """Signal end-of-stream."""
        try:
            self._queue.put_nowait(_SENTINEL)
        except asyncio.QueueFull:
            pass

    async def consume(self) -> AsyncGenerator[str, None]:
        """
        Async generator yielding SSE-formatted strings.

        Usage inside FastAPI::

            async def event_generator():
                async for chunk in bus.consume():
                    yield chunk
        """
        while True:
            item = await self._queue.get()
            if item is _SENTINEL:
                return
            yield f"data: {json.dumps(item)}\n\n"


class EventBusRegistry:
    """Process-wide registry of per-session event buses."""

    def __init__(self) -> None:
        self._buses: dict[str, SessionEventBus] = {}

    def get_or_create(self, session_id: str) -> SessionEventBus:
        if session_id not in self._buses:
            self._buses[session_id] = SessionEventBus()
        return self._buses[session_id]

    def close(self, session_id: str) -> None:
        bus = self._buses.pop(session_id, None)
        if bus:
            bus.close()


# Module-level singleton
event_registry = EventBusRegistry()
