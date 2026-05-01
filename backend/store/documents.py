"""
DocumentStore — wraps document_loader + document_chunker and persists chunks
with FTS indexing into SQLite.
"""

from __future__ import annotations

import sys
import os
from pathlib import Path
from typing import Any, Optional

# Allow imports from repo root (document_loader, document_chunker live there)
_ROOT = Path(__file__).parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from document_loader import DocumentLoader
from document_chunker import DocumentChunker
from backend.store.sessions import (
    create_document,
    insert_chunk,
    get_chunks_for_document,
    search_chunks,
    get_chunk,
    get_chunk_by_section,
)


class DocumentStore:
    """Ingest a file, chunk it, and persist chunks to SQLite with FTS5."""

    def __init__(self, chunk_tokens: int = 4000):
        self._loader = DocumentLoader()
        self._chunker = DocumentChunker(max_chunk_tokens=chunk_tokens)

    async def ingest(
        self,
        session_id: str,
        file_path: str,
        original_filename: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Load, chunk, and store a document.

        ``original_filename`` is what the user sees; ``file_path`` may be a
        random OS temp path. If omitted, we fall back to ``path.name``.

        Returns a dict with document_id, filename (user-facing), chunk_count.
        """
        path = Path(file_path)
        doc_data = self._loader.load_document(str(path))
        content: str = doc_data.get("content", "")
        page_count: int = doc_data.get("page_count", 0)

        raw_chunks = self._chunker.smart_chunk(content)

        display_name = original_filename or path.name
        document_id = await create_document(
            session_id, display_name, original_filename=display_name
        )

        chunk_ids: list[str] = []
        for idx, raw in enumerate(raw_chunks):
            chunk_content: str = raw.get("content", "")
            # Derive section_id and page from chunk metadata where available
            section_id: Optional[str] = raw.get("section_id") or raw.get("chapter_title")
            page: Optional[int] = (
                raw.get("start_page") or raw.get("page_number") or raw.get("page")
            )
            metadata = {k: v for k, v in raw.items() if k != "content"}

            cid = await insert_chunk(
                document_id=document_id,
                idx=idx,
                content=chunk_content,
                metadata=metadata,
                section_id=str(section_id) if section_id else None,
                page=int(page) if page else None,
            )
            chunk_ids.append(cid)

        return {
            "document_id": document_id,
            "filename": display_name,
            "chunk_count": len(raw_chunks),
            "page_count": page_count,
            "chunk_ids": chunk_ids,
        }

    async def get_chunks(self, document_id: str) -> list[dict]:
        return await get_chunks_for_document(document_id)

    async def get_chunk(self, chunk_id: str) -> Optional[dict]:
        return await get_chunk(chunk_id)

    async def search(self, document_id: str, query: str, limit: int = 10) -> list[dict]:
        """FTS5 keyword search scoped to a single document."""
        return await search_chunks(document_id, query, limit)

    async def resolve_section(self, document_id: str, section_id: str) -> Optional[dict]:
        """Return the chunk whose section_id matches (cross-reference resolution)."""
        return await get_chunk_by_section(document_id, section_id)
