# System Architecture - Librarian Agents Team

## Overview

The Librarian Agents Team is a multi-agent system designed for intelligent document processing, capable of handling documents from 50 to thousands of pages.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                              │
│  • Document (50 - 5000+ pages)                                  │
│  • Processing Request/Instructions                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LEAD ORCHESTRATOR AGENT                       │
│                                                                 │
│  Responsibilities:                                              │
│  ✓ Analyze user request                                        │
│  ✓ Create task breakdown                                       │
│  ✓ Delegate to specialized agents                              │
│  ✓ Manage context window (190K tokens)                         │
│  ✓ Compile final results                                       │
│  ✓ Handle continuation prompts                                 │
│                                                                 │
│  Model: Claude Sonnet 4.5                                       │
└───────┬──────────────────┬──────────────────┬──────────────────┘
        │                  │                  │
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  SUBAGENT 1  │  │  SUBAGENT 2  │  │   SUBAGENT 3     │
│              │  │              │  │                  │
│ Text         │  │ Text         │  │ Table            │
│ Specialist   │  │ Specialist   │  │ Specialist       │
│              │  │              │  │                  │
│ • Summarize  │  │ • Transform  │  │ • Generate       │
│ • Analyze    │  │ • Format     │  │   tables         │
│ • Extract    │  │ • Restructure│  │ • Merged cells   │
│ • Condense   │  │ • Convert    │  │ • Multiple       │
│              │  │              │  │   formats        │
│              │  │              │  │ • HTML/MD/CSV    │
│              │  │              │  │                  │
│ Model:       │  │ Model:       │  │ Model:           │
│ Sonnet 4.5   │  │ Sonnet 4.5   │  │ Sonnet 4.5       │
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘
       │                 │                   │
       │    ◄────────────┼──────────────────►│
       │    Inter-Agent Communication        │
       │                 │                   │
       └─────────────────┴───────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RESULT COMPILATION                             │
│                                                                  │
│  • Combine sub-agent outputs                                    │
│  • Ensure coherent flow                                         │
│  • Format final output                                          │
│  • Handle length constraints                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       USER OUTPUT                                │
│  • Compiled results (text, tables, analysis)                    │
│  • Continuation prompts (if needed)                             │
│  • Clarification requests (if needed)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Lead Orchestrator Agent

**Purpose**: Central coordination and management

**Key Functions**:
- Request analysis and task decomposition
- Intelligent delegation based on task type
- Context window management (tracks token usage)
- Result compilation and presentation
- User interaction management

**Decision Logic**:
```
IF task involves summarization OR analysis OR extraction
    → Delegate to SubAgent 1

IF task involves transformation OR formatting OR restructuring  
    → Delegate to SubAgent 2

IF task involves table generation OR data formatting
    → Delegate to SubAgent 3

IF task is complex
    → Delegate to multiple agents
    → Coordinate their outputs
```

### 2. SubAgent 1 - Text Processing Specialist

**Specializations**:
- Document summarization
- Content analysis
- Information extraction
- Key points identification
- Text condensing

**Typical Tasks**:
- "Summarize this 500-page document"
- "Extract key findings from each chapter"
- "Identify main themes and concepts"
- "Create executive summary"

### 3. SubAgent 2 - Text Transformation Specialist

**Specializations**:
- Content restructuring
- Format conversion
- Text enhancement
- Style adaptation
- Document reformatting

**Typical Tasks**:
- "Restructure for different audience"
- "Convert to bullet points"
- "Reformat with clear sections"
- "Adapt technical content for non-experts"

### 4. SubAgent 3 - Table Generation Specialist

**Specializations**:
- Table creation (Markdown, HTML, CSV)
- Complex table structures
- Merged cells and formatting
- Data extraction and tabulation
- Multi-format output

**Typical Tasks**:
- "Create comparison table"
- "Extract financial data to table"
- "Generate timeline table with merged cells"
- "Tabulate case study information"

## Data Flow

### Processing Pipeline

```
1. INPUT STAGE
   ├─ User provides document (any size)
   ├─ User provides processing request
   └─ Optional: Additional context

2. ANALYSIS STAGE (Lead Orchestrator)
   ├─ Parse user request
   ├─ Analyze document structure
   ├─ Determine required capabilities
   ├─ Create task breakdown
   └─ Assign tasks to agents

3. PROCESSING STAGE (SubAgents)
   ├─ Each agent receives assigned task
   ├─ Agents process their sections
   ├─ Agents can request clarification
   └─ Agents can collaborate

4. COMPILATION STAGE (Lead Orchestrator)
   ├─ Collect all sub-agent outputs
   ├─ Ensure logical flow
   ├─ Format consistently
   ├─ Check length constraints
   └─ Prepare final output

5. OUTPUT STAGE
   ├─ Present compiled results
   ├─ Handle continuation if needed
   └─ Respond to follow-ups
```

## Communication Patterns

### Agent-to-Agent Communication

```python
# Agents can collaborate on complex tasks
SubAgent1 → SubAgent3: "I extracted this data, can you create a table?"
SubAgent3 → SubAgent1: "Table created, need any formatting changes?"

# Agents can request clarification
SubAgent3 → Lead → User: "Need clarification on table structure"
User → Lead → SubAgent3: "Use HTML format with merged headers"
```

### Context Management

```
Context Window: 190,000 tokens (~150 pages)

Strategy:
- Lead agent monitors token usage
- Implements smart chunking for large documents
- Prompts user for continuation when needed
- Maintains coherence across chunks
```

## File Organization

```
librarian_agents_team.py
│
├─ Agent Base Class
│  └─ Shared methods and properties
│
├─ LeadOrchestratorAgent
│  ├─ analyze_request()
│  ├─ create_task_breakdown()
│  └─ compile_results()
│
├─ SubAgent1 (Text Processor)
│  ├─ process()
│  └─ get_system_prompt()
│
├─ SubAgent2 (Text Transformer)
│  ├─ process()
│  └─ get_system_prompt()
│
├─ SubAgent3 (Table Generator)
│  ├─ process()
│  └─ get_system_prompt()
│
└─ LibrarianAgentsTeam
   ├─ process_document()
   ├─ continue_processing()
   └─ answer_clarification()
```

## Key Design Principles

### 1. Specialization
Each agent has a distinct area of expertise, allowing for high-quality outputs in their domain.

### 2. Coordination
The lead orchestrator ensures smooth collaboration and coherent final outputs.

### 3. Scalability
System handles documents from 50 to thousands of pages through intelligent chunking.

### 4. Flexibility
Agents can adapt to various document types and processing requests.

### 5. User-Centric
Silent operation mode - agents work behind the scenes, presenting only results.

### 6. Robustness
Built-in error handling, clarification requests, and continuation management.

## Performance Characteristics

### Processing Speed
- Small documents (50-100 pages): ~30-60 seconds
- Medium documents (100-500 pages): ~2-5 minutes
- Large documents (500-2000 pages): ~5-15 minutes
- Very large documents (2000+ pages): Chunks processed incrementally

### Resource Usage
- Model: Claude Sonnet 4.5 (efficient for quality/speed)
- Context Window: 190K tokens per agent
- Token Optimization: Smart chunking and delegation

### Output Quality
- Specialized agents ensure domain expertise
- Lead orchestrator ensures coherence
- Multi-agent collaboration for complex tasks
- Human-like natural language output

## Integration Points

### Input Sources
```python
# From files
DocumentLoader.load_document("path/to/file.pdf")

# From strings
team.process_document(request, document_string)

# From command line
cli.py -i document.pdf -r "request"
```

### Output Formats
- Plain text (.txt)
- Markdown (.md)
- HTML (.html)
- DOCX (.docx)
- Console output

### Extension Points
```python
# Add custom agent
class CustomAgent(Agent):
    def get_system_prompt(self):
        return "Custom specialization..."
    
    def process(self, task, context):
        # Custom processing logic
        pass

# Register with team
team.agents[AgentRole.CUSTOM] = CustomAgent()
```

## Security Considerations

1. **API Key Management**: Keys stored in environment variables
2. **Input Validation**: File type and size validation
3. **Error Handling**: Graceful degradation on failures
4. **Data Privacy**: No data stored between sessions
5. **Rate Limiting**: Managed by Anthropic API

## Future Enhancements

Potential improvements:
- [ ] Add vision capabilities for image-heavy documents
- [ ] Implement parallel processing for multiple documents
- [ ] Add support for real-time streaming outputs
- [ ] Integrate with document databases
- [ ] Add support for more file formats (PPT, Excel)
- [ ] Implement agent memory across sessions
- [ ] Add visualization generation capabilities

---

**Built with Claude Sonnet 4.5 - Production Ready** 🚀
