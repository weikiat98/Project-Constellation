# Librarian Agents Team - Document Processing System

A sophisticated multi-agent system built with Python and Claude for intelligently processing large documents (50 to thousands of pages). The system uses a lead orchestrator and three specialized sub-agents to break down, analyze, and transform document content.

## 🎯 Overview

The Librarian Agents Team consists of:

- **Lead Orchestrator Agent**: Coordinates all operations, delegates tasks, compiles results, and manages context windows
- **SubAgent 1**: Text processing specialist (summarization, analysis, extraction)
- **SubAgent 2**: Text transformation specialist (formatting, restructuring, conversion)
- **SubAgent 3**: Table generation specialist (complex tables, merged cells, data formatting)

## ✨ Key Features

- **Intelligent Task Delegation**: Lead agent analyzes requests and assigns to appropriate specialists
- **Inter-Agent Communication**: Agents can collaborate and request clarification
- **Context Window Management**: Automatically handles large outputs with continuation prompts
- **Silent Operation**: Agents work behind the scenes, presenting only final results
- **Smart Document Chunking**: Handles documents by pages, chapters, or sections
- **Multiple Output Formats**: Markdown, HTML, CSV for tables and content
- **Clarification Requests**: Agents can ask users for more information when needed

## 📋 Requirements

```bash
Python 3.8+
anthropic>=0.40.0
```

## 🚀 Installation

1. **Clone or download the repository**

2. **Install dependencies**:
```bash
pip3 install anthropic --break-system-packages
```

3. **Set up your API key**:

Linux/Mac
```bash
export ANTHROPIC_API_KEY='your-api-key-here'
```

Windows

Search for Edit the system environment variables and add the ANTHROPIC_API_KEY directly.

OR

```bash
setx ANTHROPIC_API_KEY='your-api-key-here'
```

Or set it in your Python script:
```python
import os
os.environ['ANTHROPIC_API_KEY'] = 'your-api-key-here'
```

**Once API key has been added or set, it is strongly recommended to restart your terminal to see the changes.**

## 📁 Project Structure

```
librarian-agents-team/
├── ARCHITECTURE.md             # Describes the overall system design and agent interactions.
├── EXECUTION_FLOW.md           # Details the step-by-step process of how the agents complete a task.
├── PROJECT_SUMMARY.md          # High-level overview of the project's goals and functionality.
├── QUICKSTART.md               # Instructions for rapidly setting up and running the system for the first time.
├── README.md                   # The main introductory file for the repository.
├── USAGE_GUIDE.md              # Detailed documentation on how to use all features of the system.
├── advanced_examples.py        # Comprehensive usage examples and non-trivial demonstrations.
├── cli.py                      # Command-Line Interface to interact with the system.
├── document_chunker.py         # Utilities for breaking down large documents into smaller pieces.
├── document_loader.py          # Code for loading and ingesting various document types.
├── librarian_agents_team.py    # Main system file containing the definition and orchestration of all agents.
└── test_example.py             # Script for running tests or a simple example verification.
```

## 💡 Quick Start

### Basic Usage

```python
from librarian_agents_team import LibrarianAgentsTeam

# Initialize the team
team = LibrarianAgentsTeam()

# Your document content
document = """
Your large document content here...
Can be 50 pages or thousands of pages...
"""

# Process with a request
request = "Summarize this document and create a table of key points"
result = team.process_document(request, document)

print(result)
```

### Advanced Usage

```python
from librarian_agents_team import LibrarianAgentsTeam
from document_chunker import DocumentChunker

# Initialize
team = LibrarianAgentsTeam()
chunker = DocumentChunker(max_chunk_size=8000)

# Load a large document
with open('large_book.txt', 'r') as f:
    document = f.read()

# Smart chunking
chunks = chunker.smart_chunk(document)
print(f"Document split into {len(chunks)} chunks")

# Process with complex instructions
request = """
Analyze this book and provide:
1. Executive summary (3 paragraphs)
2. Chapter-by-chapter breakdown (table format)
3. Key themes and concepts
4. Important quotes with page references
"""

result = team.process_document(request, document)
print(result)
```

## 🎨 Usage Examples

### Example 1: Document Summarization

```python
document = """
[Your 500-page document here]
"""

request = "Create a 2-page executive summary highlighting the main findings and conclusions"
result = team.process_document(request, document)
```

### Example 2: Extract Data to Tables

```python
document = """
Quarterly report with sales data across multiple regions...
"""

request = """
Extract all sales data and create:
1. A regional performance table (with merged header cells)
2. A product comparison table
3. A monthly trend table

Use HTML format with proper styling.
"""

result = team.process_document(request, document)
```

### Example 3: Content Restructuring

```python
document = """
Unstructured notes and information...
"""

request = """
Restructure this content into:
- Clear hierarchical sections
- Bullet points for key items
- Code examples where relevant
- A summary at the end
"""

result = team.process_document(request, document)
```

### Example 4: Comparative Analysis

```python
document = """
Multiple product descriptions, features, pricing...
"""

request = """
Create a comprehensive comparison table with:
- Feature-by-feature comparison
- Pricing analysis
- Pros and cons for each
- Recommendation for different use cases
"""

result = team.process_document(request, document)
```

## 🔧 Advanced Features

### Document Chunking

```python
from document_chunker import DocumentChunker, ChunkMerger

chunker = DocumentChunker(max_chunk_size=8000)

# Chunk by pages (if document has page markers)
chunks = chunker.chunk_by_pages(document, pages_per_chunk=10)

# Chunk by chapters
chunks = chunker.chunk_by_chapters(document)

# Chunk by sections (paragraphs)
chunks = chunker.chunk_by_sections(document)

# Smart chunking (auto-detect structure)
chunks = chunker.smart_chunk(document)

# Merge chunks back together
merger = ChunkMerger()
merged = merger.merge_with_headers(chunks)
```

### Handling Clarifications

```python
team = LibrarianAgentsTeam()

# Initial request
result = team.process_document(request, document)

# If agent needs clarification
if "clarification" in result.lower():
    print("Agent needs more information:")
    print(result)
    
    # Provide clarification
    clarification = "Additional details here..."
    final_result = team.answer_clarification(clarification)
    print(final_result)
```

### Continuation for Long Outputs

```python
# The lead agent will automatically prompt for continuation
# when output is long

result = team.process_document(request, large_document)
print(result)

# If output says "please reply 'continue'"
if "continue" in result.lower():
    continuation = team.continue_processing()
    print(continuation)
```

## 🛠️ System Architecture

### Agent Communication Flow

```
User Request
    ↓
Lead Orchestrator
    ├─→ Analyzes request
    ├─→ Creates task breakdown
    ├─→ Delegates to SubAgents
    │   ├─→ SubAgent 1 (Text)
    │   ├─→ SubAgent 2 (Text)
    │   └─→ SubAgent 3 (Tables)
    ├─→ Collects results
    ├─→ Compiles final output
    └─→ Returns to user
```

### Task Assignment Logic

- **Text summarization, analysis, extraction** → SubAgent 1
- **Text transformation, formatting, restructuring** → SubAgent 2
- **Table generation, data formatting** → SubAgent 3
- **Complex tasks** → Multiple agents coordinated by Lead

## 📊 Configuration

### Customizing Chunk Sizes

```python
# Smaller chunks for faster processing
chunker = DocumentChunker(max_chunk_size=4000)

# Larger chunks for more context
chunker = DocumentChunker(max_chunk_size=12000)
```

### Adjusting Model Parameters

Edit `librarian_agents_team.py`:

```python
# In agent process methods, adjust max_tokens
response = client.messages.create(
    model=MODEL,
    max_tokens=16000,  # Adjust as needed
    system=self.get_system_prompt(),
    messages=[{"role": "user", "content": prompt}]
)
```

## 🎯 Best Practices

1. **For very large documents (1000+ pages)**:
   - Use document chunking first
   - Process in batches
   - Save intermediate results

2. **For complex table requests**:
   - Be specific about column names
   - Specify desired format (Markdown, HTML, CSV)
   - Mention if merged cells are needed

3. **For best results**:
   - Provide clear, specific instructions
   - Include examples of desired output format
   - Break very complex tasks into multiple requests

4. **Memory management**:
   - The system tracks context usage
   - Will prompt for continuation if needed
   - Save important results to files

## 🔍 Troubleshooting

### Issue: Agent asks for clarification repeatedly
**Solution**: Provide more specific instructions in your initial request

### Issue: Output is cut off
**Solution**: Reply with "continue" or use smaller chunk sizes

### Issue: Tables not formatted correctly
**Solution**: Specify exact format needed (HTML for complex tables, Markdown for simple)

### Issue: API key errors
**Solution**: Ensure ANTHROPIC_API_KEY is set correctly

```bash
# Check if key is set
echo $ANTHROPIC_API_KEY

# Set it if not
export ANTHROPIC_API_KEY='your-key'
```

## 📖 Running Examples

Run the included examples:

```bash
# Basic examples
python librarian_agents_team.py

# Advanced examples
python advanced_examples.py
```

## 🚦 Production Deployment

For production use:

1. **Add error handling**:
```python
try:
    result = team.process_document(request, document)
except Exception as e:
    print(f"Error processing document: {e}")
    # Handle error appropriately
```

2. **Add logging**:
```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Processing document...")
```

3. **Implement rate limiting** if processing many documents

4. **Save intermediate results** for long-running processes

5. **Add progress indicators** for user feedback

## 📝 Example Output

### Summarization Task
```
User: Summarize this 200-page technical manual

Output:
EXECUTIVE SUMMARY

[2-3 page comprehensive summary with key sections, findings, and conclusions]

KEY TECHNICAL SPECIFICATIONS
- Specification 1: Details...
- Specification 2: Details...

IMPLEMENTATION GUIDELINES
[Structured breakdown of implementation steps]
```

### Table Generation Task
```
User: Extract all financial data into a comparison table

Output:
QUARTERLY FINANCIAL COMPARISON

[Well-formatted HTML table with merged cells, proper styling, and all data organized]

ANALYSIS
- Key insight 1
- Key insight 2
```

## 🤝 Contributing

This is a production-ready system. For enhancements:

1. Add new specialized agents by extending the `Agent` base class
2. Implement custom chunking strategies in `document_chunker.py`
3. Add new output formats as needed

## 📄 License

MIT License - feel free to use in your projects

## 🆘 Support

For issues or questions:
- Check the troubleshooting section
- Review the examples in `advanced_examples.py`
- Consult Anthropic's API documentation

## 🔗 Related Resources

- [Anthropic API Documentation](https://docs.anthropic.com)
- [Claude Documentation](https://docs.claude.com)
- [Python Documentation](https://docs.python.org)

---

**Built with Claude Sonnet 4.5 for intelligent document processing** 🚀
