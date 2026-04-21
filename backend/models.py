"""
Pydantic v2 schemas for the Constellation backend.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ─── Sessions ────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    title: Optional[str] = None


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    pinned: Optional[bool] = None
    audience: Optional[str] = Field(
        default=None, pattern="^(layperson|professional|expert)$"
    )


class SessionOut(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime
    pinned: bool = False
    audience: str = "professional"

    model_config = {"from_attributes": True}


# ─── Messages ────────────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    content: str
    audience: str = Field(default="professional", pattern="^(layperson|professional|expert)$")


class MessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    token_usage: Optional[int]
    created_at: datetime
    artifact_ids: list[str] = Field(default_factory=list)
    thinking: Optional[str] = None

    model_config = {"from_attributes": True}


# ─── Documents ───────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    id: str
    session_id: str
    filename: str
    chunk_count: int
    original_filename: Optional[str] = None

    model_config = {"from_attributes": True}


class ChunkOut(BaseModel):
    id: str
    document_id: str
    index: int
    content: str
    section_id: Optional[str]
    page: Optional[int]

    model_config = {"from_attributes": True}


class DefinitionOut(BaseModel):
    id: str
    document_id: str
    term: str
    definition: str
    source_chunk_id: str

    model_config = {"from_attributes": True}


class CrossRefOut(BaseModel):
    id: str
    document_id: str
    from_chunk_id: str
    to_section_id: str

    model_config = {"from_attributes": True}


# ─── Artifacts ───────────────────────────────────────────────────────────────

class ArtifactOut(BaseModel):
    id: str
    session_id: str
    name: str
    content: str
    mime_type: str
    citations_json: Optional[str]

    model_config = {"from_attributes": True}


# ─── Agent runs ──────────────────────────────────────────────────────────────

class AgentRunOut(BaseModel):
    id: str
    session_id: str
    parent_agent_id: Optional[str]
    role: str
    status: str
    tokens_in: int
    tokens_out: int

    model_config = {"from_attributes": True}


# ─── Context meter ───────────────────────────────────────────────────────────

class ContextUsageOut(BaseModel):
    tokens: int
    window: int
    percent: float


# ─── Token counting ──────────────────────────────────────────────────────────

class TokenCountRequest(BaseModel):
    content: str = ""  # draft prompt text; empty counts just the base payload


class TokenCountOut(BaseModel):
    prompt_tokens: int        # tokens from the draft message alone
    base_tokens: int          # system prompt + tools + doc index + chat history
    total_tokens: int         # prompt_tokens + base_tokens
    window: int               # 200000
    percent: float            # total_tokens / window * 100


# ─── SSE event envelopes (for typing on the frontend) ────────────────────────

class SSEEvent(BaseModel):
    type: str
    data: dict[str, Any] = Field(default_factory=dict)


# ─── Session detail (history + artifacts) ────────────────────────────────────

class SessionDetail(BaseModel):
    session: SessionOut
    messages: list[MessageOut]
    documents: list[DocumentOut]
    artifacts: list[ArtifactOut]
