# Execution Flow Guide - Script Sequence and Dependencies

## 📋 Script Hierarchy and Dependencies

### Dependency Tree

```
librarian_agents_team.py (CORE - No dependencies on other scripts)
    ↑
    │ imports from
    │
    ├─── document_chunker.py (UTILITY - Independent)
    │
    ├─── document_loader.py (UTILITY - Independent)
    │
    ├─── cli.py (INTERFACE - Depends on all above)
    │
    ├─── advanced_examples.py (EXAMPLES - Depends on all above)
    │
    └─── test_example.py (TESTING - Depends on all above)
```

## 🎯 Execution Sequences

### Method 1: Direct Python Script Usage (Most Common)

```python
# Step 1: Import the main system
from librarian_agents_team import LibrarianAgentsTeam

# Step 2: Initialize the team
team = LibrarianAgentsTeam()

# Step 3: Process document
result = team.process_document("Your request", document_content)

# Optional: Use utilities
from document_loader import DocumentLoader
from document_chunker import DocumentChunker
```

**Sequence:**
1. `librarian_agents_team.py` runs first (imported)
2. Creates agent instances
3. Processes your request
4. Returns results

---

### Method 2: Command-Line Interface (CLI)

```bash
python cli.py -i document.pdf -r "Create summary" -o output.txt
```

**Sequence:**
1. `cli.py` runs first (entry point)
2. `cli.py` imports `librarian_agents_team.py`
3. `cli.py` imports `document_loader.py` (to load the file)
4. `cli.py` imports `document_chunker.py` (if chunking needed)
5. Processes document through the team
6. Saves output using `DocumentSaver`

---

### Method 3: Run Examples

```bash
python advanced_examples.py
# OR
python test_example.py
```

**Sequence:**
1. Example file runs first (entry point)
2. Imports `librarian_agents_team.py`
3. Imports `document_chunker.py`
4. Imports `document_loader.py`
5. Executes example scenarios
6. Displays/saves results

---

## 📊 Detailed Execution Flow

### Scenario A: Processing a Document from Python

```python
# 1. Import (librarian_agents_team.py loads first)
from librarian_agents_team import LibrarianAgentsTeam

# 2. Initialize
team = LibrarianAgentsTeam()
# This creates:
#   - LeadOrchestratorAgent instance
#   - SubAgent1 instance  
#   - SubAgent2 instance
#   - SubAgent3 instance

# 3. Process
result = team.process_document(request, document)
# Internally this:
#   a. Lead analyzes request (analyze_request method)
#   b. Lead creates task breakdown
#   c. Lead delegates to SubAgents
#   d. SubAgents process their tasks
#   e. Lead compiles results (compile_results method)
#   f. Returns final output

# 4. Use result
print(result)
```

---

### Scenario B: Using CLI with File Loading

```bash
python cli.py -i large_book.pdf -r "Summarize" -o summary.txt
```

**Internal Flow:**

```python
# 1. cli.py starts execution
import argparse
from librarian_agents_team import LibrarianAgentsTeam
from document_loader import DocumentLoader, DocumentSaver

# 2. Parse command-line arguments
args = parser.parse_args()

# 3. Load document
loader = DocumentLoader()
doc_data = loader.load_document(args.input)  # Loads PDF
content = doc_data['content']

# 4. Initialize agents
team = LibrarianAgentsTeam()

# 5. Process document
result = team.process_document(args.request, content)

# 6. Save output
saver = DocumentSaver()
saver.save_text(result, args.output)
```

---

### Scenario C: Processing Large Document with Chunking

```python
# 1. Import utilities
from librarian_agents_team import LibrarianAgentsTeam
from document_chunker import DocumentChunker
from document_loader import DocumentLoader

# 2. Load document
loader = DocumentLoader()
doc_data = loader.load_document('huge_document.pdf')
content = doc_data['content']

# 3. Chunk document (if very large)
chunker = DocumentChunker(max_chunk_size=8000)
chunks = chunker.smart_chunk(content)
print(f"Split into {len(chunks)} chunks")

# 4. Initialize team
team = LibrarianAgentsTeam()

# 5. Process
result = team.process_document(request, content)

# 6. Save
from document_loader import DocumentSaver
saver = DocumentSaver()
saver.save_html(result, 'output.html')
```

---

## 🔑 Key Points

### Core System (Always Runs First When Imported)
- **librarian_agents_team.py** - Main system, no dependencies on other scripts
  - Contains all agent classes
  - Self-contained execution logic
  - Can run standalone

### Utilities (Run When Needed)
- **document_chunker.py** - Independent utility, no dependencies
- **document_loader.py** - Independent utility, no dependencies
- Can be used separately or together

### Interfaces (Entry Points)
- **cli.py** - Command-line entry point, imports all above
- **advanced_examples.py** - Example entry point, imports all above
- **test_example.py** - Test entry point, imports all above

---

## 🎬 Execution Order Summary

### For Normal Usage:

**Python Script Usage:**
```
Your script → librarian_agents_team.py → Agent processing → Results
```

**CLI Usage:**
```
cli.py → document_loader.py → librarian_agents_team.py → Results → document_loader.py (save)
```

**With Chunking:**
```
Your script → document_loader.py → document_chunker.py → librarian_agents_team.py → Results
```

---

## 💻 Standalone Execution

Each file can also run standalone:

### Run Main System Standalone
```bash
python librarian_agents_team.py
# Executes built-in examples in main()
```

### Run Document Chunker Standalone
```bash
python document_chunker.py
# Shows chunking examples
```

### Run Document Loader Standalone
```bash
python document_loader.py
# Shows loading/saving examples
```

### Run CLI
```bash
python cli.py -i file.pdf -r "request" -o output.txt
```

### Run Examples
```bash
python advanced_examples.py
# Runs 6 example scenarios

python test_example.py  
# Runs comprehensive test suite
```

---

## 🔄 Import Dependencies

### No External Dependencies
- `librarian_agents_team.py` - Only needs: anthropic, os, json, typing, dataclasses, enum
- `document_chunker.py` - Only needs: typing, re
- `document_loader.py` - Only needs: os, typing, pathlib

### Optional Dependencies (for file loading)
- `PyPDF2` - For PDF files (document_loader.py)
- `python-docx` - For DOCX files (document_loader.py)

---

## 🎯 Recommended Execution Order for First-Time Users

1. **Test the system**: `python test_example.py`
   - Creates sample document
   - Runs 4 comprehensive tests
   - Shows all capabilities

2. **Try interactive mode**: `python cli.py -i document.pdf --interactive`
   - Hands-on experience
   - Ask questions interactively
   - See results immediately

3. **Use in your scripts**: Import and use programmatically
   ```python
   from librarian_agents_team import LibrarianAgentsTeam
   team = LibrarianAgentsTeam()
   result = team.process_document(request, document)
   ```

---

## 📝 Quick Reference

| What You Want to Do | Which Script Runs First | Command |
|---------------------|------------------------|---------|
| Use in Python code | librarian_agents_team.py (imported) | `from librarian_agents_team import LibrarianAgentsTeam` |
| Command line processing | cli.py | `python cli.py -i file.pdf -r "request"` |
| See examples | advanced_examples.py | `python advanced_examples.py` |
| Run tests | test_example.py | `python test_example.py` |
| Load documents | document_loader.py (imported) | `from document_loader import DocumentLoader` |
| Chunk documents | document_chunker.py (imported) | `from document_chunker import DocumentChunker` |

---

## ✅ Bottom Line

**Simple Answer:**
- **For command-line use**: `cli.py` runs first
- **For Python scripts**: `librarian_agents_team.py` runs first (via import)
- **For testing/examples**: `test_example.py` or `advanced_examples.py` run first

**The utilities** (`document_chunker.py`, `document_loader.py`) are **helper modules** that run only when imported/needed.

**All entry points eventually import and execute `librarian_agents_team.py`** which is the core system.
