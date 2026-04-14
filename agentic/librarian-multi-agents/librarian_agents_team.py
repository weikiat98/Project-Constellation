"""
Librarian Agents Team - Document Processing System
A multi-agent system for breaking down large documents with specialized agents

OPTIMIZED FOR CLAUDE HAIKU 4.5 with 1-hour prompt caching
"""

import os
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum
from anthropic import Anthropic

# Initialize Anthropic client
client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"

class AgentRole(Enum):
    LEAD_ORCHESTRATOR = "lead_orchestrator"
    SUBAGENT_1 = "subagent_1"  # Text specialist
    SUBAGENT_2 = "subagent_2"  # Text specialist
    SUBAGENT_3 = "subagent_3"  # Table specialist

@dataclass
class Task:
    """Represents a task assigned to an agent"""
    task_id: str
    description: str
    content: str
    assigned_to: AgentRole
    status: str = "pending"
    result: Optional[str] = None
    requires_clarification: bool = False
    clarification_question: Optional[str] = None

@dataclass
class Message:
    """Represents a message in the conversation"""
    role: str  # 'user' or 'assistant'
    content: str
    agent: Optional[AgentRole] = None

class Agent:
    """Base class for all agents"""
    
    def __init__(self, role: AgentRole, name: str, specialization: str):
        self.role = role
        self.name = name
        self.specialization = specialization
        self.conversation_history: List[Message] = []
        
    def get_system_prompt(self) -> str:
        """Return the system prompt for this agent"""
        raise NotImplementedError
        
    def process(self, task: Task, context: Dict[str, Any]) -> Dict[str, Any]:
        """Process a task and return results"""
        raise NotImplementedError

class LeadOrchestratorAgent(Agent):
    """
    Lead Orchestrator Agent - Coordinates all subagents and compiles results
    """
    
    def __init__(self):
        super().__init__(
            AgentRole.LEAD_ORCHESTRATOR,
            "Lead Orchestrator",
            "Task coordination, delegation, and result compilation"
        )
        
    def get_system_prompt(self) -> str:
        return """You are the Lead Orchestrator Agent in a librarian agents team.

Your responsibilities:
1. Analyze user requests for document processing tasks
2. Break down large tasks into smaller subtasks
3. Delegate tasks to specialized subagents:
   - SubAgent 1 & 2: Text processing, summarization, analysis, rewriting
   - SubAgent 3: Table generation, data formatting, complex table structures
4. Compile results from all subagents into coherent output
5. Manage context window constraints by tracking token usage
6. Ask users to continue when output is interrupted due to length

Key behaviors:
- DO NOT explain your process unless the user specifically asks with follow-up questions
- Silently coordinate subagents and present only final compiled results
- When context limits are reached, end with: "Due to length constraints, please reply 'continue' to see the rest."
- Only provide explanations about methodology when explicitly asked
- Be efficient and direct in presenting results
- Coordinate inter-agent communication when agents need to collaborate

You can delegate tasks, review subagent outputs, and compile comprehensive final results."""

    def analyze_request(self, user_request: str, document_content: str) -> List[Task]:
        """Analyze user request and create task breakdown"""
        
        response = client.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=self.get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Document Preview (first 5000 chars):\n{document_content[:5000]}",
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        },
                        {
                            "type": "text",
                            "text": f"""User Request: {user_request}

Total document length: {len(document_content)} characters

Create a JSON task breakdown with this structure:
{{
    "tasks": [
        {{
            "task_id": "unique_id",
            "description": "what needs to be done",
            "assigned_to": "subagent_1|subagent_2|subagent_3",
            "content_section": "which part of document"
        }}
    ],
    "coordination_notes": "any special instructions for coordination"
}}

Guidelines:
- Assign text processing to subagent_1 or subagent_2
- Assign table generation to subagent_3
- Break large documents into manageable chunks
- Consider document structure (pages, chapters, sections)"""
                        }
                    ]
                }
            ]
        )
        
        # Parse response and create Task objects
        response_text = response.content[0].text
        
        # Extract JSON from response
        try:
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            task_data = json.loads(response_text[json_start:json_end])
            
            tasks = []
            for task_info in task_data.get("tasks", []):
                agent_map = {
                    "subagent_1": AgentRole.SUBAGENT_1,
                    "subagent_2": AgentRole.SUBAGENT_2,
                    "subagent_3": AgentRole.SUBAGENT_3
                }
                
                tasks.append(Task(
                    task_id=task_info["task_id"],
                    description=task_info["description"],
                    content=task_info.get("content_section", ""),
                    assigned_to=agent_map[task_info["assigned_to"]]
                ))
            
            return tasks
        except (json.JSONDecodeError, KeyError) as e:
            # Fallback: create simple task
            return [Task(
                task_id="task_1",
                description=user_request,
                content=document_content,
                assigned_to=AgentRole.SUBAGENT_1
            )]
    
    def compile_results(self, tasks: List[Task], user_request: str) -> str:
        """Compile all subagent results into final output"""
        
        results_summary = "\n\n".join([
            f"=== {task.task_id}: {task.description} ===\n{task.result}"
            for task in tasks if task.result
        ])
        
        response = client.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=self.get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Subagent Results:\n{results_summary}",
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        },
                        {
                            "type": "text",
                            "text": f"""Original User Request: {user_request}

Instructions:
- Present a unified, well-structured output
- Maintain logical flow between sections
- DO NOT explain the process or mention subagents
- Present only the final compiled content
- If the output is very long, prepare to stop and ask user to continue
- Be direct and professional"""
                        }
                    ]
                }
            ]
        )
        
        return response.content[0].text

class SubAgent1(Agent):
    """SubAgent 1 - Text Processing Specialist"""
    
    def __init__(self):
        super().__init__(
            AgentRole.SUBAGENT_1,
            "SubAgent 1",
            "Text processing, summarization, and analysis"
        )
        
    def get_system_prompt(self) -> str:
        return """You are SubAgent 1, a text processing specialist in a librarian agents team.

Your expertise:
- Document summarization and condensing
- Text analysis and extraction
- Content restructuring and rewriting
- Key points identification
- Narrative text processing

Guidelines:
- Process text efficiently and accurately
- Maintain original meaning when summarizing
- Be thorough but concise
- Ask clarifying questions when requirements are ambiguous
- Collaborate with other agents when needed

You work under the Lead Orchestrator's direction."""

    def process(self, task: Task, context: Dict[str, Any]) -> Dict[str, Any]:
        """Process assigned text task"""
        
        response = client.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=self.get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Content to process:\n{task.content}",
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        },
                        {
                            "type": "text",
                            "text": f"Task: {task.description}\n\nAdditional context: {json.dumps(context, indent=2)}\n\nProvide the processed output directly. If you need clarification, clearly state your question."
                        }
                    ]
                }
            ]
        )
        
        result_text = response.content[0].text
        
        # Check if agent needs clarification
        needs_clarification = any(phrase in result_text.lower() for phrase in [
            "need clarification",
            "could you clarify",
            "unclear about",
            "could you specify"
        ])
        
        return {
            "result": result_text,
            "needs_clarification": needs_clarification,
            "status": "completed" if not needs_clarification else "awaiting_clarification"
        }

class SubAgent2(Agent):
    """SubAgent 2 - Text Processing Specialist"""
    
    def __init__(self):
        super().__init__(
            AgentRole.SUBAGENT_2,
            "SubAgent 2",
            "Text processing, transformation, and formatting"
        )
        
    def get_system_prompt(self) -> str:
        return """You are SubAgent 2, a text processing specialist in a librarian agents team.

Your expertise:
- Text transformation and conversion
- Content formatting and styling
- Document restructuring
- Text enhancement and editing
- Multiple format outputs

Guidelines:
- Handle text with precision
- Adapt to different formatting requirements
- Maintain document structure integrity
- Ask clarifying questions when needed
- Coordinate with other agents for complex tasks

You work under the Lead Orchestrator's direction."""

    def process(self, task: Task, context: Dict[str, Any]) -> Dict[str, Any]:
        """Process assigned text task"""
        
        response = client.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=self.get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Content to process:\n{task.content}",
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        },
                        {
                            "type": "text",
                            "text": f"Task: {task.description}\n\nAdditional context: {json.dumps(context, indent=2)}\n\nProvide the processed output directly. If you need clarification, clearly state your question."
                        }
                    ]
                }
            ]
        )
        
        result_text = response.content[0].text
        
        needs_clarification = any(phrase in result_text.lower() for phrase in [
            "need clarification",
            "could you clarify",
            "unclear about",
            "could you specify"
        ])
        
        return {
            "result": result_text,
            "needs_clarification": needs_clarification,
            "status": "completed" if not needs_clarification else "awaiting_clarification"
        }

class SubAgent3(Agent):
    """SubAgent 3 - Table Generation Specialist"""
    
    def __init__(self):
        super().__init__(
            AgentRole.SUBAGENT_3,
            "SubAgent 3",
            "Table generation and complex data formatting"
        )
        
    def get_system_prompt(self) -> str:
        return """You are SubAgent 3, a table generation specialist in a librarian agents team.

Your expertise:
- Creating tables in multiple formats (Markdown, HTML, CSV)
- Complex table structures with merged cells
- Data extraction and tabulation
- Table formatting and styling
- Converting text to structured table formats

Guidelines:
- Generate clean, well-formatted tables
- Handle merged cells and complex structures
- Support multiple output formats
- Ensure data accuracy in tables
- Ask for clarification on table structure when needed

You work under the Lead Orchestrator's direction.

When creating tables:
- Use Markdown for simple tables
- Use HTML for complex tables with merged cells
- Clearly label columns and rows
- Maintain data integrity"""

    def process(self, task: Task, context: Dict[str, Any]) -> Dict[str, Any]:
        """Process assigned table generation task"""
        
        response = client.messages.create(
            model=MODEL,
            max_tokens=32000,
            system=self.get_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Content to process:\n{task.content}",
                            "cache_control": {"type": "ephemeral", "ttl": "1h"}
                        },
                        {
                            "type": "text",
                            "text": f"Task: {task.description}\n\nAdditional context: {json.dumps(context, indent=2)}\n\nGenerate the requested table. If you need clarification about table structure, column names, or formatting, clearly state your question."
                        }
                    ]
                }
            ]
        )
        
        result_text = response.content[0].text
        
        needs_clarification = any(phrase in result_text.lower() for phrase in [
            "need clarification",
            "could you clarify",
            "unclear about",
            "could you specify"
        ])
        
        return {
            "result": result_text,
            "needs_clarification": needs_clarification,
            "status": "completed" if not needs_clarification else "awaiting_clarification"
        }

class LibrarianAgentsTeam:
    """Main orchestration class for the librarian agents team"""
    
    def __init__(self):
        self.lead = LeadOrchestratorAgent()
        self.subagent1 = SubAgent1()
        self.subagent2 = SubAgent2()
        self.subagent3 = SubAgent3()
        self.agents = {
            AgentRole.LEAD_ORCHESTRATOR: self.lead,
            AgentRole.SUBAGENT_1: self.subagent1,
            AgentRole.SUBAGENT_2: self.subagent2,
            AgentRole.SUBAGENT_3: self.subagent3
        }
        self.current_tasks: List[Task] = []
        self.conversation_state = {
            "awaiting_continuation": False,
            "pending_clarifications": []
        }
        
    def process_document(self, user_request: str, document_content: str, 
                        context: Optional[Dict[str, Any]] = None) -> str:
        """
        Main entry point for document processing
        
        Args:
            user_request: User's instruction for document processing
            document_content: The document content to process
            context: Optional additional context
            
        Returns:
            Processed output from the agents team
        """
        if context is None:
            context = {}
            
        print(f"[SYSTEM] Lead Orchestrator analyzing request...")
        
        # Step 1: Lead orchestrator analyzes and creates tasks
        self.current_tasks = self.lead.analyze_request(user_request, document_content)
        
        print(f"[SYSTEM] Created {len(self.current_tasks)} tasks")
        print(f"[SYSTEM] Delegating to subagents...")
        
        # Step 2: Process each task with appropriate subagent
        for task in self.current_tasks:
            agent = self.agents[task.assigned_to]
            print(f"[SYSTEM] {agent.name} processing: {task.description}")
            
            result = agent.process(task, context)
            task.result = result["result"]
            task.status = result["status"]
            task.requires_clarification = result["needs_clarification"]
            
            if task.requires_clarification:
                self.conversation_state["pending_clarifications"].append(task)
        
        # Step 3: Check for clarifications needed
        if self.conversation_state["pending_clarifications"]:
            clarification_messages = []
            for task in self.conversation_state["pending_clarifications"]:
                clarification_messages.append(
                    f"**{self.agents[task.assigned_to].name}** needs clarification for:\n"
                    f"Task: {task.description}\n"
                    f"Question: {task.result}"
                )
            return "\n\n".join(clarification_messages)
        
        # Step 4: Lead orchestrator compiles results
        print(f"[SYSTEM] Lead Orchestrator compiling final output...")
        final_output = self.lead.compile_results(self.current_tasks, user_request)
        
        return final_output
    
    def continue_processing(self) -> str:
        """Continue processing when user requests continuation"""
        if not self.conversation_state["awaiting_continuation"]:
            return "No pending continuation. Please provide a new document processing request."
        
        # Resume from where we left off
        return "Continuing processing..."
    
    def answer_clarification(self, answer: str) -> str:
        """Process user's answer to clarification questions"""
        if not self.conversation_state["pending_clarifications"]:
            return "No pending clarifications. Ready for new tasks."
        
        # Re-process tasks with clarification
        for task in self.conversation_state["pending_clarifications"]:
            context = {"clarification": answer}
            agent = self.agents[task.assigned_to]
            result = agent.process(task, context)
            task.result = result["result"]
            task.status = result["status"]
            task.requires_clarification = result["needs_clarification"]
        
        self.conversation_state["pending_clarifications"] = []
        
        # Compile final results
        final_output = self.lead.compile_results(self.current_tasks, "Clarified task")
        return final_output

def main():
    """Example usage of the librarian agents team"""
    
    print("=" * 80)
    print("LIBRARIAN AGENTS TEAM - Document Processing System")
    print("=" * 80)
    print()
    
    # Initialize the team
    team = LibrarianAgentsTeam()
    
    