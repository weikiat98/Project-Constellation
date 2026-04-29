"""
Definition extractor.

Scans document chunks for defined-term patterns common in legal/policy/regulatory
documents and stores them via the sessions store.

Patterns detected:
  "X" means ...
  "X" has the meaning ...
  "X" refers to ...
  "X" is defined as ...
  In this Act/regulation, "X" means ...
"""

from __future__ import annotations

import re
from typing import Optional

from backend.store.sessions import insert_definition

# Regex: captures a quoted term and its definition clause.
#
# The definition body is non-greedy and capped by length, with a terminator
# of `;` or end-of-paragraph (double newline) — but NOT the first period.
# Legal definitions routinely span multiple sentences ("X means …. This
# includes …."); the original `[^;\.]` cut off everything after the first
# period, so most multi-sentence definitions were truncated.
_DEF_PATTERNS = [
    # "term" means <definition>
    re.compile(
        r'"(?P<term>[^"]{1,80})"\s+(?:means?|refers?\s+to|is\s+defined\s+as|has\s+the\s+meaning)\s+'
        r'(?P<definition>(?:(?!\n\s*\n)[^;]){10,500}?)(?=\s*(?:;|\n\s*\n|$))',
        re.IGNORECASE | re.DOTALL,
    ),
    # "term" shall mean <definition>
    re.compile(
        r'"(?P<term>[^"]{1,80})"\s+shall\s+(?:mean|refer\s+to)\s+'
        r'(?P<definition>(?:(?!\n\s*\n)[^;]){10,500}?)(?=\s*(?:;|\n\s*\n|$))',
        re.IGNORECASE | re.DOTALL,
    ),
]


async def extract_definitions(
    document_id: str, chunks: list[dict]
) -> list[dict]:
    """
    Run definition extraction across all chunks and persist results.

    Returns a list of dicts {term, definition, source_chunk_id}.
    """
    seen_terms: set[str] = set()
    results: list[dict] = []

    for chunk in chunks:
        text: str = chunk.get("content", "")
        chunk_id: str = chunk["id"]

        for pattern in _DEF_PATTERNS:
            for m in pattern.finditer(text):
                term = m.group("term").strip()
                definition = m.group("definition").strip()

                key = term.lower()
                if key in seen_terms:
                    continue
                seen_terms.add(key)

                await insert_definition(
                    document_id=document_id,
                    term=term,
                    definition=definition,
                    source_chunk_id=chunk_id,
                )
                results.append(
                    {"term": term, "definition": definition, "source_chunk_id": chunk_id}
                )

    return results
