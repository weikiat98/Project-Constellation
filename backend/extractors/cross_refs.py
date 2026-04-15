"""
Cross-reference extractor.

Detects within-document references in legal/policy documents and persists them.

Patterns detected:
  Section 4(2), Article 12(b), Clause 3, Part II, Schedule 1, Annex A
"""

from __future__ import annotations

import re

from backend.store.sessions import insert_cross_ref

_XREF_PATTERN = re.compile(
    r'\b(?:section|article|clause|part|schedule|annex|paragraph|regulation|rule|subsection)'
    r'\s+(?P<ref>\d+(?:\([a-z0-9]+\))*(?:\s*(?:and|to)\s*\d+(?:\([a-z0-9]+\))*)?)',
    re.IGNORECASE,
)


def _normalise_section_id(raw: str) -> str:
    """Collapse whitespace and uppercase for consistent section IDs."""
    return re.sub(r'\s+', ' ', raw).strip().upper()


async def extract_cross_refs(
    document_id: str, chunks: list[dict]
) -> list[dict]:
    """
    Scan chunks for cross-references to other sections and persist them.

    Returns a list of dicts {from_chunk_id, to_section_id}.
    """
    results: list[dict] = []

    for chunk in chunks:
        text: str = chunk.get("content", "")
        chunk_id: str = chunk["id"]

        seen_in_chunk: set[str] = set()
        for m in _XREF_PATTERN.finditer(text):
            full_match = m.group(0)
            section_id = _normalise_section_id(full_match)

            if section_id in seen_in_chunk:
                continue
            seen_in_chunk.add(section_id)

            await insert_cross_ref(
                document_id=document_id,
                from_chunk_id=chunk_id,
                to_section_id=section_id,
            )
            results.append({"from_chunk_id": chunk_id, "to_section_id": section_id})

    return results
