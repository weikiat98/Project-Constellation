"""
Structured error classification for Anthropic API failures.

Every error surfaced to the chat carries two strings:
  - `technical`: the exact API status code + error type + raw message, useful
    for engineers debugging from a screenshot or a bug report.
  - `layman`: a plain-English explanation of what happened and what the user
    can do about it, written for a non-technical reader.

Codes mirror Anthropic's error reference
(https://platform.claude.com/docs/en/api/errors and
https://code.claude.com/docs/en/errors).
"""

from __future__ import annotations

from dataclasses import dataclass

import anthropic


@dataclass
class ErrorPayload:
    code: str           # short stable identifier, e.g. "rate_limit"
    status: int | None  # HTTP status if applicable
    technical: str      # engineer-facing message
    layman: str         # user-facing plain-English message

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "status": self.status,
            "technical": self.technical,
            "layman": self.layman,
        }


_LAYMAN_BY_STATUS: dict[int, tuple[str, str]] = {
    400: (
        "invalid_request",
        "Something about the request to the AI service was malformed. "
        "Try rephrasing your question or starting a new chat.",
    ),
    401: (
        "auth_failed",
        "The AI service rejected our credentials. The site administrator "
        "needs to refresh the API key — please try again later.",
    ),
    403: (
        "permission_denied",
        "We don't have permission to use the requested AI feature. "
        "Please contact the site administrator.",
    ),
    404: (
        "not_found",
        "The resource you asked for couldn't be found. It may have been "
        "deleted, or the link is out of date.",
    ),
    408: (
        "timeout",
        "The AI service took too long to respond. Please try again — "
        "shorter prompts and fewer attached documents help.",
    ),
    409: (
        "conflict",
        "This action conflicts with the current state. Refresh the page "
        "and try again.",
    ),
    413: (
        "payload_too_large",
        "Your message or attachment is too large for the AI to process. "
        "Try removing some documents or shortening your prompt.",
    ),
    429: (
        "rate_limit",
        "We're sending requests to the AI service faster than it allows. "
        "Please wait a moment and try again — it usually clears within a minute.",
    ),
    500: (
        "server_error",
        "The AI service had an unexpected problem on its end. This isn't "
        "something you did — please try again in a minute.",
    ),
    502: (
        "bad_gateway",
        "We couldn't reach the AI service. Please try again shortly.",
    ),
    503: (
        "service_unavailable",
        "The AI service is temporarily unavailable. Please try again in a moment.",
    ),
    504: (
        "gateway_timeout",
        "The AI service didn't respond in time. Please try again.",
    ),
    529: (
        "overloaded",
        "The AI service is at capacity right now. This isn't your usage "
        "limit — please wait a minute and try again.",
    ),
}


def classify(exc: BaseException) -> ErrorPayload:
    """Convert any exception into a structured user/technical message pair."""
    # Anthropic-typed errors expose a status code we can map directly.
    if isinstance(exc, anthropic.APIStatusError):
        status = getattr(exc, "status_code", None) or 0
        code, layman = _LAYMAN_BY_STATUS.get(
            status,
            (
                "api_error",
                "The AI service returned an unexpected error. Please try again.",
            ),
        )
        body = getattr(exc, "message", None) or str(exc)
        technical = f"HTTP {status} {type(exc).__name__}: {body}"
        return ErrorPayload(code=code, status=status, technical=technical, layman=layman)

    if isinstance(exc, anthropic.RateLimitError):
        code, layman = _LAYMAN_BY_STATUS[429]
        return ErrorPayload(
            code=code,
            status=429,
            technical=f"HTTP 429 RateLimitError: {exc}",
            layman=layman,
        )

    if isinstance(exc, anthropic.APITimeoutError):
        code, layman = _LAYMAN_BY_STATUS[408]
        return ErrorPayload(
            code=code,
            status=408,
            technical=f"APITimeoutError: {exc}",
            layman=layman,
        )

    if isinstance(exc, anthropic.APIConnectionError):
        return ErrorPayload(
            code="connection_error",
            status=None,
            technical=f"APIConnectionError: {exc}",
            layman=(
                "We couldn't reach the AI service — this usually means a "
                "network hiccup on our side. Please try again in a moment."
            ),
        )

    # Generic fallback for everything else (orchestrator bugs, tool failures, etc.)
    return ErrorPayload(
        code="internal_error",
        status=None,
        technical=f"{type(exc).__name__}: {exc}",
        layman=(
            "Something went wrong while preparing your answer. "
            "Please try again, or start a new chat if the problem persists."
        ),
    )
