# Quick Start Guide - Librarian Agents Team

## 🚀 Get Started in 3 Minutes

### Step 1: Install Dependencies

```bash
pip install anthropic --break-system-packages
```

### Step 2: Set API Key

```bash
export ANTHROPIC_API_KEY='your-api-key-here'
```

### Step 3: Run Your First Document Processing

#### Option A: Using Python Script

```python
from librarian_agents_team import LibrarianAgentsTeam

# Initialize
team = LibrarianAgentsTeam()

# Your document
document = """
[Paste your document content here - can be 50 to thousands of pages]
"""

# Process
request = "Summarize this document and extract key points into a table"
result = team.process_document(request, document)

print(result)
```

#### Option B: Using Command Line

```bash
# Simple usage
python cli.py -i document.pdf -r "Create a summary" -o summary.txt

# Interactive mode
python cli.py -i document.pdf --interactive

# With verbose output
python cli.py -i large_book.txt -r "Extract all data to tables" -o tables.html --verbose
```

#### Option C: Run Test Example

```bash
# This creates a sample document and runs 4 comprehensive tests
python test_example.py
```

## 📋 Common Use Cases

### 1. Summarize a Long Document

```python
request = "Create a 2-page executive summary with key findings"
result = team.process_document(request, your_document)
```

### 2. Extract Data to Tables

```python
request = """
Extract all financial data and create:
- Quarterly comparison table
- Regional performance table
Use HTML format with merged cells
"""
result = team.process_document(request, your_document)
```

### 3. Restructure Content

```python
request = """
Restructure this content with:
- Clear hierarchical sections
- Bullet points for key items
- Summary at the end
"""
result = team.process_document(request, your_document)
```

### 4. Comparative Analysis

```python
request = """
Compare the products/concepts mentioned and create:
- Side-by-side comparison table
- Pros and cons for each
- Recommendations
"""
result = team.process_document(request, your_document)
```

## 🎯 What Each Agent Does

- **Lead Orchestrator**: Coordinates everything, delegates tasks, compiles results
- **SubAgent 1**: Text summarization, analysis, extraction
- **SubAgent 2**: Text transformation, formatting, restructuring
- **SubAgent 3**: Table generation (including complex tables with merged cells)

## 💡 Pro Tips

1. **Be specific** in your requests - the more detail, the better the output
2. **For large documents** (1000+ pages), consider chunking first
3. **For complex tables**, specify exact format needed (HTML for merged cells)
4. **Interactive mode** is great for iterative refinement
5. **Save important results** immediately - agents don't retain memory between sessions

## 🔧 File Structure

```
librarian-agents-team/
├── librarian_agents_team.py    # Main system ⭐
├── cli.py                      # Command-line interface
├── document_chunker.py         # Document chunking utilities
├── document_loader.py          # Load PDF, DOCX, TXT files
├── advanced_examples.py        # Detailed examples
├── test_example.py            # Comprehensive test suite
└── README.md                  # Full documentation
```

## ⚡ Quick Commands

```bash
# Interactive session
python cli.py -i mydoc.pdf --interactive

# Generate summary
python cli.py -i book.txt -r "Summarize in 500 words" -o summary.md

# Extract tables
python cli.py -i report.docx -r "Extract all data to tables" -o data.html

# Custom processing
python cli.py -i thesis.pdf -r "Your custom instruction here" -o output.txt
```

## 🆘 Troubleshooting

**API Key Error?**
```bash
export ANTHROPIC_API_KEY='sk-ant-...'
```

**File Not Found?**
- Check file path is correct
- Use absolute paths if needed

**Need More Help?**
- Check `README.md` for full documentation
- Run `python test_example.py` to see examples
- Look at `advanced_examples.py` for complex scenarios

## 📚 Next Steps

1. ✅ Start with `test_example.py` to see capabilities
2. ✅ Try `cli.py --interactive` for hands-on experience  
3. ✅ Read `README.md` for advanced features
4. ✅ Customize for your specific use case

**You're ready to process documents! 🎉**
