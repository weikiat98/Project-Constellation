"""
Tool definitions and handlers for the LeadOrchestrator.

The Lead has access to these tools:
  - read_document_chunk
  - search_document
  - resolve_reference
  - lookup_definition
  - spawn_subagent       (implemented in lead.py to avoid circular imports)
  - write_artifact
  - finalize
"""

from __future__ import annotations

from typing import Any

from backend.store.sessions import (
    get_chunk,
    search_chunks,
    get_chunk_by_section,
    lookup_definition,
    create_artifact,
)

# ─── Tool schemas (sent to Claude) ───────────────────────────────────────────

LEAD_TOOLS: list[dict] = [
    {
        "name": "read_document_chunk",
        "description": "Fetch the full text of a specific document chunk by its chunk ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "chunk_id": {
                    "type": "string",
                    "description": "The UUID of the chunk to retrieve.",
                }
            },
            "required": ["chunk_id"],
        },
    },
    {
        "name": "search_document",
        "description": (
            "Keyword/BM25 full-text search within the loaded document. "
            "Returns the top matching chunks with their IDs, section references, and page numbers. "
            "Use this to find relevant passages without reading the whole document."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {
                    "type": "string",
                    "description": "The document to search within.",
                },
                "query": {
                    "type": "string",
                    "description": "Keywords or phrase to search for.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default 8).",
                    "default": 8,
                },
            },
            "required": ["document_id", "query"],
        },
    },
    {
        "name": "resolve_reference",
        "description": (
            "Fetch the chunk that corresponds to an internal cross-reference "
            "(e.g., 'Section 4(2)', 'Article 12'). "
            "Returns the chunk text and metadata, or null if not found."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "section_id": {
                    "type": "string",
                    "description": "The section/article reference as it appears in the document.",
                },
            },
            "required": ["document_id", "section_id"],
        },
    },
    {
        "name": "lookup_definition",
        "description": (
            "Look up the definition of a term as defined within the document. "
            "Returns the definition text and the chunk it came from, or null if not found."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "term": {
                    "type": "string",
                    "description": "The term to look up.",
                },
            },
            "required": ["document_id", "term"],
        },
    },
    {
        "name": "spawn_subagent",
        "description": (
            "Spawn a specialised subagent to perform a focused subtask in parallel. "
            "Describe the role precisely — the subagent sees only what you give it. "
            "Every factual claim the subagent makes MUST include a chunk_id citation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "role": {
                    "type": "string",
                    "description": (
                        "System-prompt role for this subagent, e.g. "
                        "'Extract every obligation imposed on small businesses with section reference and penalty.'"
                    ),
                },
                "task": {
                    "type": "string",
                    "description": "The specific task instruction for this subagent.",
                },
                "chunk_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "List of chunk IDs the subagent should receive as context. "
                        "Keep this minimal — only what the subagent needs."
                    ),
                },
            },
            "required": ["role", "task", "chunk_ids"],
        },
    },
    {
        "name": "write_artifact",
        "description": (
            "Persist a named artifact (summary, table, obligation list, etc.) to the session. "
            "Every citation in the artifact must reference a valid chunk_id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Short human-readable name for the artifact.",
                },
                "content": {
                    "type": "string",
                    "description": "The artifact content (Markdown, HTML, CSV, or plain text).",
                },
                "mime_type": {
                    "type": "string",
                    "description": "MIME type: 'text/plain' (default), 'text/markdown', 'text/html', or 'text/csv'. Use 'text/plain' unless the user explicitly requests a different format.",
                    "enum": ["text/plain", "text/markdown", "text/html", "text/csv"],
                    "default": "text/plain",
                },
                "citations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "chunk_id": {"type": "string"},
                            "quote": {"type": "string"},
                        },
                        "required": ["chunk_id"],
                    },
                    "description": "List of source citations backing this artifact.",
                },
            },
            "required": ["name", "content"],
        },
    },
    {
        "name": "finalize",
        "description": "End the agent run and return the final answer to the user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "result": {
                    "type": "string",
                    "description": "The final answer, with inline citations [chunk_id].",
                }
            },
            "required": ["result"],
        },
    },
]

# ─── Tool handler dispatch ────────────────────────────────────────────────────

async def handle_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    session_id: str,
    document_ids: list[str],
) -> Any:
    """
    Execute a tool call and return its result.
    'spawn_subagent' is NOT handled here — it's intercepted in lead.py.
    """
    if tool_name == "read_document_chunk":
        chunk = await get_chunk(tool_input["chunk_id"])
        if chunk is None:
            return {"error": f"Chunk {tool_input['chunk_id']} not found."}
        return {
            "chunk_id": chunk["id"],
            "content": chunk["content"],
            "section_id": chunk.get("section_id"),
            "page": chunk.get("page"),
        }

    if tool_name == "search_document":
        doc_id = tool_input.get("document_id", document_ids[0] if document_ids else "")
        limit = int(tool_input.get("limit", 8))
        results = await search_chunks(doc_id, tool_input["query"], limit)
        return [
            {
                "chunk_id": r["id"],
                "snippet": r["content"][:300],
                "section_id": r.get("section_id"),
                "page": r.get("page"),
                "score": r.get("score"),
            }
            for r in results
        ]

    if tool_name == "resolve_reference":
        doc_id = tool_input.get("document_id", document_ids[0] if document_ids else "")
        chunk = await get_chunk_by_section(doc_id, tool_input["section_id"])
        if chunk is None:
            return {"error": f"Section '{tool_input['section_id']}' not found."}
        return {
            "chunk_id": chunk["id"],
            "section_id": chunk.get("section_id"),
            "page": chunk.get("page"),
            "content": chunk["content"],
        }

    if tool_name == "lookup_definition":
        doc_id = tool_input.get("document_id", document_ids[0] if document_ids else "")
        defn = await lookup_definition(doc_id, tool_input["term"])
        if defn is None:
            return {"error": f"Term '{tool_input['term']}' not defined in document."}
        return {
            "term": defn["term"],
            "definition": defn["definition"],
            "source_chunk_id": defn["source_chunk_id"],
        }

    if tool_name == "write_artifact":
        aid = await create_artifact(
            session_id=session_id,
            name=tool_input["name"],
            content=tool_input["content"],
            mime_type=tool_input.get("mime_type", "text/plain"),
            citations=tool_input.get("citations"),
        )
        return {"artifact_id": aid, "name": tool_input["name"]}

    if tool_name == "finalize":
        # Handled by the orchestrator loop — should not reach here
        return {"result": tool_input["result"]}

    return {"error": f"Unknown tool: {tool_name}"}
