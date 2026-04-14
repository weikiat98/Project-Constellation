# Librarian Agents Team - Project Summary

## 📦 About

A multi-agent system for processing large documents (50-5000+ pages) using Python and Claude to overcome LLM limitations of limited context window by dividing the task to multiple agents and save precious time for the user in reading these documents.

## 🎯 Core Components

### Main System Files

1. **librarian_agents_team.py** (20KB)
   - Complete agent system with Lead Orchestrator and 3 SubAgents
   - All agent logic, coordination, and processing
   - Main entry point for programmatic use

2. **cli.py** (7KB)
   - Command-line interface for easy usage
   - Interactive and batch modes
   - File input/output handling

3. **document_chunker.py** (10KB)
   - Smart document chunking utilities
   - Handles pages, chapters, sections
   - Automatic structure detection

4. **document_loader.py** (11KB)
   - Load documents from PDF, DOCX, TXT, HTML, MD
   - Extract text and metadata
   - Save in multiple formats

### Example & Documentation Files

5. **advanced_examples.py** (16KB)
   - 6 comprehensive usage examples
   - Real-world scenarios
   - Best practices demonstrations

6. **test_example.py** (24KB)
   - Complete test suite with sample document
   - 4 comprehensive tests covering all capabilities
   - Generates sample outputs

7. **README.md** (11KB)
   - Complete documentation
   - Installation and setup
   - Usage examples and troubleshooting

8. **QUICKSTART.md** (3KB)
   - Get started in 3 minutes
   - Common use cases
   - Quick commands

9. **ARCHITECTURE.md** (6KB)
   - System architecture diagrams
   - Component details
   - Design principles

10. **USAGE_GUIDE.md**
    - how to use the files and script

11. **PROJECT_SUMMARY.md**
    - Exective summary of this project

12. **EXECUTION_FLOW.md**
    - Visual Diagram of workflow

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install anthropic --break-system-packages
```

### 2. Set API Key

Linux/Mac
```bash
export ANTHROPIC_API_KEY='your-api-key-here'
```

Windows
```bash
set ANTHROPIC_API_KEY='your-api-key-here'
```
OR

Search for Edit the system environment variables and set your ANTHROPIC_API_KEY directly.

### 3. Use It

**Option A: Python Script**
```python
from librarian_agents_team import LibrarianAgentsTeam

team = LibrarianAgentsTeam()
result = team.process_document("Summarize this document", your_document)
print(result)
```

**Option B: Command Line**
```bash
python cli.py -i document.pdf -r "Create summary" -o output.txt
```

**Option C: Interactive**
```bash
python cli.py -i document.pdf --interactive
```

## 💪 What It Can Do

### Document Processing
- ✅ Summarize documents (any length)
- ✅ Extract key information
- ✅ Analyze themes and patterns
- ✅ Break down complex content

### Table Generation
- ✅ Create comparison tables
- ✅ Extract data to tables
- ✅ Complex tables with merged cells
- ✅ Multiple formats (HTML, Markdown, CSV)

### Content Transformation
- ✅ Restructure for different audiences
- ✅ Format and style content
- ✅ Convert between formats
- ✅ Adapt complexity levels

### Smart Features
- ✅ Handles 50-5000+ page documents
- ✅ Auto-detects document structure
- ✅ Manages context window intelligently
- ✅ Asks clarification questions when needed
- ✅ Supports continuation for long outputs

## 🎨 Agent Capabilities

### Lead Orchestrator
- Coordinates all operations
- Delegates to specialists
- Compiles final results
- Manages context and continuation

### SubAgent 1 (Text Specialist)
- Summarization
- Analysis
- Extraction
- Condensing

### SubAgent 2 (Text Transformer)
- Restructuring
- Formatting
- Style adaptation
- Content conversion

### SubAgent 3 (Table Specialist)
- Table generation
- Complex formatting
- Merged cells
- Multi-format output

## 📊 Example Use Cases

1. **Research Paper Analysis**
   - Input: 150-page research paper
   - Output: Executive summary + key findings table

2. **Business Report Processing**
   - Input: 300-page annual report
   - Output: Chapter summaries + financial data tables

3. **Book Summarization**
   - Input: 500-page book
   - Output: Chapter-by-chapter breakdown + themes analysis

4. **Technical Documentation**
   - Input: 2000-page technical manual
   - Output: Restructured for different audiences + quick reference tables

## 🔧 Customization Options

### Adjust Chunk Sizes
```python
chunker = DocumentChunker(max_chunk_size=10000)
```

### Custom Context
```python
context = {"target_audience": "executives", "format": "formal"}
result = team.process_document(request, document, context)
```

### Output Formats
```python
# Save as different formats
DocumentSaver.save_html(result, "output.html")
DocumentSaver.save_markdown(result, "output.md")
DocumentSaver.save_to_docx(result, "output.docx")
```

## 📈 Performance

- **Processing Speed**: 30 seconds to 15 minutes depending on size
- **Document Range**: 50 to 5000+ pages
- **Context Window**: 190K tokens per agent
- **Quality**: Claude Sonnet 4.5 (highest quality)

## ✅ Production Ready

This system is:
- ✅ Fully functional and tested
- ✅ Well-documented
- ✅ Error handling included
- ✅ Extensible and customizable
- ✅ Command-line ready
- ✅ Python script ready

## 🎯 Next Steps

1. **Try the test example**
   ```bash
   python test_example.py
   ```

2. **Process your first document**
   ```bash
   python cli.py -i your_document.pdf --interactive
   ```

3. **Read the documentation**
   - Start with QUICKSTART.md
   - Then README.md for details
   - Check ARCHITECTURE.md for internals

4. **Customize for your needs**
   - Modify agent prompts
   - Add custom processing logic
   - Integrate with your workflow

## 💡 Pro Tips

1. Start with interactive mode to understand capabilities
2. Use verbose mode when debugging
3. Save important results immediately
4. Be specific in your requests for best results
5. Use HTML format for complex tables

## 🆘 Support

**Common Issues:**
- API Key not set: `export ANTHROPIC_API_KEY='your-key'` or `set ANTHROPIC_API_KEY into system environment variables for windows`
- File not found: Use absolute paths
- Install errors: Use `--break-system-packages` flag

**Resources:**
- Full docs in README.md
- Examples in advanced_examples.py
- Architecture in ARCHITECTURE.md

