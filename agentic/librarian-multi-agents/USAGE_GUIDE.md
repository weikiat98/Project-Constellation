# Simple Usage Guide - Which Script to Run?

## 🎯 Quick Answer

### I want to... | Run this... | Command
```
┌────────────────────────────────────┬──────────────────────────┬─────────────────────────────────────┐
│ WHAT YOU WANT                      │ SCRIPT TO RUN            │ COMMAND                             │
├────────────────────────────────────┼──────────────────────────┼─────────────────────────────────────┤
│ Process a file (command-line)      │ cli.py                   │ python cli.py -i file.pdf -r "..." │
│ Interactive document processing    │ cli.py                   │ python cli.py -i file.pdf --interactive │
│ Use in my Python program           │ librarian_agents_team.py │ from librarian_agents_team import... │
│ See examples of what it can do     │ advanced_examples.py     │ python advanced_examples.py         │
│ Test the complete system           │ test_example.py          │ python test_example.py              │
└────────────────────────────────────┴──────────────────────────┴─────────────────────────────────────┘
```

## 📚 The 4 Core Files Explained

### 1. **librarian_agents_team.py** 
**What it is:** The brain of the system - contains all 4 agents
**When it runs:** Automatically when you import it or run CLI
**Run it directly?** Can, but usually imported by other scripts
**Dependencies:** None (standalone)

```python
# Import and use
from librarian_agents_team import LibrarianAgentsTeam
team = LibrarianAgentsTeam()
result = team.process_document(request, document)
```

---

### 2. **cli.py**
**What it is:** Command-line interface - easiest way to use the system
**When it runs:** When you execute it from terminal
**Run it directly?** YES - this is the main entry point for command-line use
**Dependencies:** Uses librarian_agents_team.py, document_loader.py

```bash
# Command-line usage (MOST COMMON FOR USERS)
python cli.py -i document.pdf -r "Create summary" -o output.txt

# Interactive mode (RECOMMENDED FOR FIRST TIME)
python cli.py -i document.pdf --interactive
```

---

### 3. **document_chunker.py**
**What it is:** Utility for splitting large documents into chunks
**When it runs:** When you need to chunk documents (optional)
**Run it directly?** Can run standalone to see examples, but usually imported
**Dependencies:** None (standalone)

```python
# Optional - use when needed
from document_chunker import DocumentChunker
chunker = DocumentChunker()
chunks = chunker.smart_chunk(document)
```

---

### 4. **document_loader.py**
**What it is:** Utility for loading/saving documents (PDF, DOCX, TXT, etc.)
**When it runs:** When you need to load files (optional)
**Run it directly?** Can run standalone to see examples, but usually imported
**Dependencies:** PyPDF2 (for PDF), python-docx (for DOCX) - optional

```python
# Optional - use when needed
from document_loader import DocumentLoader
loader = DocumentLoader()
doc = loader.load_document('file.pdf')
```

---

## 🚀 Typical Usage Scenarios

### Scenario 1: "I just want to process a document NOW"

**Use cli.py - Interactive Mode**
```bash
python cli.py -i your_document.pdf --interactive
```

**What happens:**
1. cli.py starts
2. cli.py loads your document using document_loader.py
3. cli.py initializes librarian_agents_team.py
4. You type your request
5. Agents process it
6. You see results immediately

---

### Scenario 2: "I want to integrate into my Python program"

**Import librarian_agents_team.py**
```python
from librarian_agents_team import LibrarianAgentsTeam

# Your code
team = LibrarianAgentsTeam()
document = "your document content here..."
result = team.process_document("Summarize this", document)
print(result)
```

**What happens:**
1. Your script runs
2. Imports librarian_agents_team.py
3. Creates agent team
4. Processes document
5. Returns results to your code

---

### Scenario 3: "I want to see examples first"

**Run test_example.py or advanced_examples.py**
```bash
python test_example.py
```

**What happens:**
1. test_example.py runs
2. Creates a sample document
3. Imports librarian_agents_team.py
4. Runs 4 comprehensive tests
5. Shows you all capabilities
6. Saves output files for you to examine

---

### Scenario 4: "I have a huge document (1000+ pages)"

**Use document_chunker.py with the main system**
```python
from librarian_agents_team import LibrarianAgentsTeam
from document_chunker import DocumentChunker
from document_loader import DocumentLoader

# Load
loader = DocumentLoader()
doc = loader.load_document('huge_book.pdf')

# Chunk
chunker = DocumentChunker()
chunks = chunker.smart_chunk(doc['content'])

# Process
team = LibrarianAgentsTeam()
result = team.process_document(request, doc['content'])
```

**What happens:**
1. Your script runs
2. document_loader.py loads the PDF
3. document_chunker.py splits it into manageable pieces
4. librarian_agents_team.py processes it
5. Returns comprehensive results

---

## 🎬 Execution Sequence Visualized

### Command-Line Usage (cli.py)
```
YOU RUN:
  python cli.py -i doc.pdf -r "summarize"
       ↓
  [cli.py STARTS]
       ↓
  Imports document_loader.py → Loads your PDF
       ↓
  Imports librarian_agents_team.py → Initializes agents
       ↓
  [Lead Orchestrator analyzes request]
       ↓
  [SubAgents process their tasks]
       ↓
  [Lead Orchestrator compiles results]
       ↓
  Saves output using document_loader.py
       ↓
  YOU GET: output.txt
```

### Python Script Usage
```
YOU WRITE:
  from librarian_agents_team import LibrarianAgentsTeam
  team = LibrarianAgentsTeam()
  result = team.process_document(request, doc)
       ↓
  [librarian_agents_team.py imports and loads]
       ↓
  [Team initializes - all 4 agents created]
       ↓
  [Lead Orchestrator analyzes your request]
       ↓
  [SubAgents process their tasks]
       ↓
  [Lead Orchestrator compiles results]
       ↓
  YOU GET: result variable with output
```

---

## 📋 Dependency Chain

```
┌─────────────────────────────────────┐
│   librarian_agents_team.py          │ ← CORE (no dependencies on other scripts)
│   (Main System)                     │
└─────────────────────────────────────┘
                ↑                ↑
                │                │
                │                │
    ┌───────────┴────┐    ┌─────┴────────────┐
    │                │    │                  │
┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ document_     │  │ document_       │  │ cli.py          │
│ chunker.py    │  │ loader.py       │  │ (uses all)      │
└───────────────┘  └─────────────────┘  └─────────────────┘
  UTILITY           UTILITY              INTERFACE
  (standalone)      (standalone)         (entry point)
```

---

## ✅ Best Practice for New Users

### Step 1: Test the System
```bash
python test_example.py
```
This shows you what the system can do with no setup needed.

### Step 2: Try Interactive Mode
```bash
python cli.py -i your_document.pdf --interactive
```
This lets you experiment with your own documents.

### Step 3: Integrate Into Your Code
```python
from librarian_agents_team import LibrarianAgentsTeam
# Now use it in your programs
```

---

## 🔑 Key Takeaways

1. **For command-line users**: Start with `cli.py`
   - Most user-friendly
   - Interactive mode available
   - Handles file loading automatically

2. **For Python developers**: Import `librarian_agents_team.py`
   - Use in your scripts
   - Full programmatic control
   - Integrate into workflows

3. **Helper utilities**: Use as needed
   - `document_loader.py` - Load/save files
   - `document_chunker.py` - Split large documents

4. **All paths lead to**: `librarian_agents_team.py`
   - This is the core that does the actual work
   - Everything else is interface or utilities

---

## 💡 Simple Mental Model

Think of it like a restaurant:

- **librarian_agents_team.py** = The kitchen (where the cooking happens)
- **cli.py** = The waiter (takes your order, brings you food)
- **document_loader.py** = The prep station (prepares ingredients)
- **document_chunker.py** = The chopping station (cuts things to size)

**You can:**
- Order through the waiter (use cli.py) ← EASIEST
- Go directly to the kitchen (import librarian_agents_team.py) ← MOST FLEXIBLE
- Use the prep/chopping stations directly (utilities) ← WHEN NEEDED

---

## 🎯 Final Recommendation

**If you're new**: Start with `python cli.py --interactive`

**If you're a developer**: Start with importing `librarian_agents_team.py`

**If you want to see capabilities**: Run `python test_example.py`

**All files work together seamlessly - there's no wrong way to use the system!**
