"""
Document Chunking Utilities
Helper functions for splitting large documents into manageable chunks
"""

from typing import List, Dict, Tuple
import re

def _estimate_tokens(text: str) -> int:
    """Estimate token count using the ~4 chars/token rule for English prose."""
    return len(text) // 4


class DocumentChunker:
    """Handles intelligent document chunking based on structure"""

    def __init__(self, max_chunk_tokens: int = 4000):
        """
        Initialize chunker

        Args:
            max_chunk_tokens: Maximum tokens per chunk (estimated at ~4 chars/token)
        """
        self.max_chunk_tokens = max_chunk_tokens
        
    def chunk_by_pages(self, content: str, pages_per_chunk: int = 10) -> List[Dict[str, any]]:
        """
        Split document by page markers

        Args:
            content: Document content with page markers (e.g., "--- Page 1 ---")
            pages_per_chunk: Number of pages per chunk

        Returns:
            List of chunks with metadata
        """
        # Look for page markers. With a capturing group, re.split places the
        # captured page number at odd indices: [pre, num, body, num, body, ...].
        page_pattern = r'-{3,}\s*Page\s+(\d+)\s*-{3,}'
        pages = re.split(page_pattern, content)

        chunks = []
        current_chunk = ""
        current_pages: List[int] = []
        # First element of the split is anything before the first page marker;
        # iterate as (page_num_str, page_body) tuples after that so each chunk
        # is labelled with the actual page number from the marker.
        leading = pages[0] if pages else ""
        if leading.strip():
            current_chunk = leading
            current_pages = [1]

        i = 1
        while i + 1 < len(pages):
            try:
                page_num = int(pages[i])
            except (TypeError, ValueError):
                page_num = current_pages[-1] + 1 if current_pages else 1
            page_content = pages[i + 1]
            i += 2

            if _estimate_tokens(current_chunk) + _estimate_tokens(page_content) > self.max_chunk_tokens or \
               len(current_pages) >= pages_per_chunk:
                if current_chunk:
                    chunks.append({
                        "content": current_chunk,
                        "pages": current_pages.copy(),
                        "start_page": current_pages[0] if current_pages else page_num,
                        "end_page": current_pages[-1] if current_pages else page_num
                    })
                current_chunk = page_content
                current_pages = [page_num]
            else:
                current_chunk += page_content
                current_pages.append(page_num)

        # Add remaining content
        if current_chunk:
            chunks.append({
                "content": current_chunk,
                "pages": current_pages,
                "start_page": current_pages[0] if current_pages else 1,
                "end_page": current_pages[-1] if current_pages else 1
            })

        return chunks
    
    def chunk_by_chapters(self, content: str) -> List[Dict[str, any]]:
        """
        Split document by chapters
        
        Args:
            content: Document content with chapter markers
            
        Returns:
            List of chunks with metadata
        """
        # Look for chapter markers (various formats)
        chapter_patterns = [
            r'CHAPTER\s+(\d+|[IVXLCDM]+)',  # CHAPTER 1 or CHAPTER I
            r'Chapter\s+(\d+|[IVXLCDM]+)',
            r'^#+\s+',  # Markdown headers
        ]
        
        chunks = []
        current_chunk = ""
        current_chapter = 0
        
        lines = content.split('\n')
        
        for line in lines:
            is_chapter = any(re.match(pattern, line.strip()) for pattern in chapter_patterns)
            
            if is_chapter and current_chunk:
                # Save previous chapter
                chunks.append({
                    "content": current_chunk,
                    "chapter": current_chapter,
                    "type": "chapter"
                })
                current_chunk = line + '\n'
                current_chapter += 1
            else:
                current_chunk += line + '\n'
                
                # Check if chunk is too large
                if _estimate_tokens(current_chunk) > self.max_chunk_tokens:
                    chunks.append({
                        "content": current_chunk,
                        "chapter": current_chapter,
                        "type": "chapter_part"
                    })
                    current_chunk = ""
        
        # Add remaining content
        if current_chunk:
            chunks.append({
                "content": current_chunk,
                "chapter": current_chapter if current_chapter > 0 else 1,
                "type": "chapter"
            })
        
        return chunks
    
    def chunk_by_sections(self, content: str) -> List[Dict[str, any]]:
        """
        Split document by sections (paragraphs or logical breaks)
        
        Args:
            content: Document content
            
        Returns:
            List of chunks with metadata
        """
        chunks = []
        paragraphs = content.split('\n\n')
        current_chunk = ""
        chunk_num = 0
        
        for para in paragraphs:
            if _estimate_tokens(current_chunk) + _estimate_tokens(para) > self.max_chunk_tokens and current_chunk:
                chunks.append({
                    "content": current_chunk,
                    "chunk_id": chunk_num,
                    "type": "section"
                })
                current_chunk = para
                chunk_num += 1
            else:
                current_chunk += para + "\n\n"
        
        if current_chunk:
            chunks.append({
                "content": current_chunk,
                "chunk_id": chunk_num,
                "type": "section"
            })
        
        return chunks
    
    def smart_chunk(self, content: str, preserve_structure: bool = True) -> List[Dict[str, any]]:
        """
        Intelligently chunk document based on its structure
        
        Args:
            content: Document content
            preserve_structure: Try to preserve document structure in chunks
            
        Returns:
            List of chunks with metadata
        """
        # Try to detect document structure
        has_pages = bool(re.search(r'-{3,}\s*Page\s+\d+\s*-{3,}', content))
        has_chapters = bool(re.search(r'(CHAPTER|Chapter)\s+(\d+|[IVXLCDM]+)', content))
        
        if has_pages:
            return self.chunk_by_pages(content)
        elif has_chapters:
            return self.chunk_by_chapters(content)
        else:
            return self.chunk_by_sections(content)
    
    def estimate_pages(self, content: str, chars_per_page: int = 3000) -> int:
        """
        Estimate number of pages in document
        
        Args:
            content: Document content
            chars_per_page: Average characters per page
            
        Returns:
            Estimated page count
        """
        return max(1, len(content) // chars_per_page)

class ChunkMerger:
    """Handles merging of processed chunks back together"""
    
    @staticmethod
    def merge_chunks(chunks: List[Dict[str, any]], separator: str = "\n\n") -> str:
        """
        Merge processed chunks back together
        
        Args:
            chunks: List of processed chunks
            separator: Separator between chunks
            
        Returns:
            Merged content
        """
        return separator.join([chunk.get("content", "") for chunk in chunks])
    
    @staticmethod
    def merge_with_headers(chunks: List[Dict[str, any]]) -> str:
        """
        Merge chunks with section headers
        
        Args:
            chunks: List of processed chunks with metadata
            
        Returns:
            Merged content with headers
        """
        result = []
        
        for chunk in chunks:
            if "chapter" in chunk:
                result.append(f"=== Chapter {chunk['chapter']} ===\n")
            elif "pages" in chunk:
                start = chunk.get("start_page", "?")
                end = chunk.get("end_page", "?")
                result.append(f"=== Pages {start}-{end} ===\n")
            elif "chunk_id" in chunk:
                result.append(f"=== Section {chunk['chunk_id'] + 1} ===\n")
            
            result.append(chunk.get("content", ""))
            result.append("\n\n")
        
        return "".join(result)

def load_document(file_path: str) -> str:
    """
    Load document from file
    
    Args:
        file_path: Path to document file
        
    Returns:
        Document content as string
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def save_document(content: str, file_path: str):
    """
    Save document to file
    
    Args:
        content: Document content
        file_path: Path to save document
    """
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
