"""
Client-side rate-limit protection for Anthropic API calls.

Two layered defenses against burst traffic and 429 responses:

1. A semaphore-based concurrency cap so the orchestrator never has more than
   `MAX_CONCURRENT_REQUESTS` Anthropic streams open at once. Subagents spawned
   in parallel by the Lead would otherwise all start streaming simultaneously,
   spiking the per-minute token budget.

2. An async retry wrapper that catches `RateLimitError` (429), `APITimeoutError`,
   `APIConnectionError`, and 5xx `APIStatusError` and replays the call with
   exponential backoff. When the server provides a `retry-after` header, that
   wait is honored verbatim per Anthropic's documented contract.

The retry budget is bounded by `MAX_RETRIES`; non-retryable errors
(`AuthenticationError`, `BadRequestError`, `PermissionDeniedError`, etc.) raise
immediately so they surface to the user without delay.
"""

from __future__ import annotations

import asyncio
import os
import random
from typing import Any, Awaitable, Callable, TypeVar

import anthropic

T = TypeVar("T")

MAX_CONCURRENT_REQUESTS = int(os.environ.get("ANTHROPIC_MAX_CONCURRENCY", "3"))
MAX_RETRIES = int(os.environ.get("ANTHROPIC_MAX_RETRIES", "5"))
BASE_BACKOFF_SECONDS = float(os.environ.get("ANTHROPIC_BASE_BACKOFF", "1.0"))
MAX_BACKOFF_SECONDS = float(os.environ.get("ANTHROPIC_MAX_BACKOFF", "30.0"))

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)


def _retry_after_seconds(exc: BaseException) -> float | None:
    """Extract the `retry-after` header from an Anthropic API exception."""
    response = getattr(exc, "response", None)
    if response is None:
        return None
    headers = getattr(response, "headers", None) or {}
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _backoff_seconds(attempt: int, exc: BaseException | None = None) -> float:
    """Honor `retry-after` if present, otherwise exponential backoff with jitter."""
    if exc is not None:
        retry_after = _retry_after_seconds(exc)
        if retry_after is not None:
            return min(retry_after, MAX_BACKOFF_SECONDS)
    delay = min(BASE_BACKOFF_SECONDS * (2 ** attempt), MAX_BACKOFF_SECONDS)
    return delay + random.uniform(0, delay * 0.25)


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (anthropic.RateLimitError, anthropic.APITimeoutError, anthropic.APIConnectionError)):
        return True
    if isinstance(exc, anthropic.APIStatusError):
        status = getattr(exc, "status_code", None)
        return status is not None and status >= 500
    return False


async def with_retry(call: Callable[[], Awaitable[T]]) -> T:
    """Execute an async API call under the global concurrency cap with retries.

    `call` must be a zero-arg coroutine factory (a lambda that returns a fresh
    awaitable each invocation) so it can be re-invoked on retry.
    """
    last_exc: BaseException | None = None
    async with _semaphore:
        for attempt in range(MAX_RETRIES + 1):
            try:
                return await call()
            except Exception as exc:
                last_exc = exc
                if not _is_retryable(exc) or attempt == MAX_RETRIES:
                    raise
                await asyncio.sleep(_backoff_seconds(attempt, exc))
    assert last_exc is not None
    raise last_exc


class _RetryingStream:
    """Async-context-manager wrapper that retries the open of a streaming call.

    Anthropic streams are opened with `client.messages.stream(...)` and consumed
    via `async with`. We can't retry mid-stream (partial output is already
    delivered), but we *can* retry when the server rejects the open with 429 or
    a transient 5xx — that's the common surge case.
    """

    def __init__(self, open_stream: Callable[[], Any]):
        self._open_stream = open_stream
        self._stream_cm: Any = None
        self._stream: Any = None

    async def __aenter__(self):
        last_exc: BaseException | None = None
        async with _semaphore:
            for attempt in range(MAX_RETRIES + 1):
                cm = self._open_stream()
                try:
                    self._stream = await cm.__aenter__()
                    self._stream_cm = cm
                    return self._stream
                except Exception as exc:
                    last_exc = exc
                    if not _is_retryable(exc) or attempt == MAX_RETRIES:
                        raise
                    await asyncio.sleep(_backoff_seconds(attempt, exc))
        assert last_exc is not None
        raise last_exc

    async def __aexit__(self, exc_type, exc, tb):
        if self._stream_cm is None:
            return False
        return await self._stream_cm.__aexit__(exc_type, exc, tb)


def retrying_stream(open_stream: Callable[[], Any]) -> _RetryingStream:
    """Return an `async with`-compatible wrapper that retries the stream open."""
    return _RetryingStream(open_stream)
