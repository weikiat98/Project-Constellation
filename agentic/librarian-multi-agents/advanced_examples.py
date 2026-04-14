"""
Advanced Usage Examples for Librarian Agents Team
Demonstrates various document processing scenarios
"""

import os
from librarian_agents_team import LibrarianAgentsTeam
from document_chunker import DocumentChunker, ChunkMerger

def example_1_large_document_summary():
    """Example: Summarizing a large document with chapters"""
    
    print("\n" + "="*80)
    print("EXAMPLE 1: Large Document Summary")
    print("="*80 + "\n")
    
    # Simulate a large document
    large_document = """
    CHAPTER 1: THE RISE OF MACHINE LEARNING
    
    Machine learning has transformed from a niche academic field to a cornerstone
    of modern technology. In the early 2000s, few could predict the massive impact
    that algorithms like neural networks would have on everyday life.
    
    The foundations were laid decades earlier by pioneers like Alan Turing, who
    asked whether machines could think. Frank Rosenblatt's perceptron in 1958
    represented one of the first attempts at a learning algorithm.
    
    However, the field experienced several "AI winters" - periods where funding
    dried up and progress stalled. The breakthrough came with three key developments:
    massive datasets (like ImageNet), powerful GPUs for parallel processing, and
    refined algorithms (particularly backpropagation).
    
    CHAPTER 2: DEEP LEARNING REVOLUTION
    
    The 2012 ImageNet competition marked a turning point. A deep learning model
    called AlexNet reduced error rates by an unprecedented margin. This proved
    that deep neural networks could outperform traditional methods.
    
    Deep learning models consist of multiple layers of artificial neurons. Each
    layer learns increasingly abstract representations. The first layer might
    detect edges, the second layer combines edges into shapes, and deeper layers
    recognize complete objects.
    
    This hierarchical learning mirrors how the human visual cortex processes
    information. The key insight was that with enough data and computing power,
    these networks could learn useful representations automatically, without
    manual feature engineering.
    
    CHAPTER 3: NATURAL LANGUAGE PROCESSING BREAKTHROUGHS
    
    Natural Language Processing (NLP) underwent its own revolution with the
    introduction of transformer architectures in 2017. The "Attention is All
    You Need" paper introduced a mechanism that allowed models to weigh the
    importance of different words in a sentence.
    
    This led to models like BERT (2018) which could understand context bidirectionally,
    and GPT (2018-present) which demonstrated remarkable text generation capabilities.
    These models could be pre-trained on massive text corpora and then fine-tuned
    for specific tasks.
    
    The scale of these models grew exponentially. GPT-3 (2020) had 175 billion
    parameters and could perform many tasks with zero training examples. This
    emergence of "few-shot learning" suggested that language models were learning
    general patterns about language and reasoning.
    
    CHAPTER 4: APPLICATIONS AND IMPACT
    
    Machine learning applications now permeate society:
    
    Healthcare: Diagnostic imaging, drug discovery, personalized treatment plans
    Finance: Fraud detection, algorithmic trading, credit scoring
    Transportation: Autonomous vehicles, route optimization, traffic prediction
    Entertainment: Recommendation systems, content creation, game AI
    Manufacturing: Quality control, predictive maintenance, supply chain optimization
    
    Each application brings both opportunities and challenges. While ML can process
    information at scales impossible for humans, concerns about bias, privacy, and
    transparency remain paramount.
    
    CHAPTER 5: ETHICAL CONSIDERATIONS AND FUTURE DIRECTIONS
    
    As ML systems become more powerful, ethical considerations become more urgent.
    Key concerns include:
    
    Bias and Fairness: Models trained on historical data may perpetuate or amplify
    existing biases. Ensuring fairness requires careful dataset curation and
    evaluation metrics beyond raw accuracy.
    
    Privacy: ML models can inadvertently memorize and leak sensitive information
    from training data. Techniques like differential privacy and federated learning
    aim to address this.
    
    Interpretability: Deep neural networks are often "black boxes" - their decisions
    are difficult to explain. Explainable AI (XAI) research seeks to make models
    more transparent.
    
    Job Displacement: Automation may displace workers in certain sectors, requiring
    societal adaptation and retraining programs.
    
    Looking forward, research focuses on making models more efficient (requiring
    less data and computation), more robust (handling distribution shifts), and
    more aligned with human values. The development of artificial general intelligence
    (AGI) remains a distant but important consideration.
    
    The future of machine learning will likely involve closer human-AI collaboration,
    with AI augmenting rather than replacing human capabilities. Success will require
    not just technical innovation but also thoughtful governance and public engagement.
    """
    
    team = LibrarianAgentsTeam()
    
    request = """
    Create a comprehensive executive summary of this document. Include:
    1. A brief overview of each chapter (2-3 sentences each)
    2. Key technological milestones mentioned
    3. Main applications discussed
    4. Critical ethical concerns raised
    
    Format the output with clear sections and bullet points where appropriate.
    """
    
    result = team.process_document(request, large_document)
    print(result)

def example_2_extract_data_to_table():
    """Example: Extracting data and creating tables"""
    
    print("\n\n" + "="*80)
    print("EXAMPLE 2: Extract Data to Table")
    print("="*80 + "\n")
    
    document = """
    QUARTERLY SALES REPORT - Q4 2024
    
    Our sales performance across regions showed strong growth in Q4 2024.
    
    North America region achieved $2.5 million in revenue with 1,250 units sold,
    representing a 15% growth compared to Q3. The team was led by Sarah Johnson.
    
    Europe region recorded $1.8 million in revenue with 900 units sold, showing
    12% growth quarter-over-quarter. Regional manager: Michael Schmidt.
    
    Asia-Pacific had exceptional performance with $3.2 million in revenue and
    1,600 units sold, marking 22% growth. This region is managed by Li Wei.
    
    Latin America generated $1.1 million in revenue with 550 units sold, with
    8% growth from the previous quarter. Manager: Carlos Rodriguez.
    
    The top-performing products were:
    - Product Alpha: 2,100 units sold across all regions
    - Product Beta: 1,500 units sold
    - Product Gamma: 900 units sold
    - Product Delta: 800 units sold
    """
    
    team = LibrarianAgentsTeam()
    
    request = """
    Create two tables from this sales report:
    
    Table 1: Regional Performance
    - Columns: Region, Revenue ($ millions), Units Sold, Growth %, Manager
    - Sort by revenue (highest to lowest)
    
    Table 2: Top Products
    - Columns: Product Name, Units Sold
    - Sort by units sold (highest to lowest)
    
    Use HTML format with proper table styling for both tables.
    Include merged header cells where appropriate.
    """
    
    result = team.process_document(request, document)
    print(result)

def example_3_restructure_content():
    """Example: Restructuring and reformatting content"""
    
    print("\n\n" + "="*80)
    print("EXAMPLE 3: Restructure Content")
    print("="*80 + "\n")
    
    document = """
    Python Best Practices Guide
    
    When writing Python code, there are several important practices to follow.
    First, always use meaningful variable names. Instead of using x, y, z,
    use descriptive names like user_count, total_revenue, or customer_data.
    
    Another important practice is to follow PEP 8 style guidelines. This includes
    using 4 spaces for indentation, limiting lines to 79 characters, and using
    snake_case for function names. Also, add docstrings to your functions and
    classes to explain what they do.
    
    Error handling is crucial. Use try-except blocks to catch exceptions gracefully.
    Don't use bare except clauses - always specify the exception type you're catching.
    Also, use context managers (with statements) when working with files or resources.
    
    Type hints are valuable for code clarity. Add type annotations to function
    parameters and return values. This helps with IDE autocomplete and catches
    errors early. For example: def calculate_total(prices: List[float]) -> float:
    
    Testing is essential. Write unit tests for your functions using pytest or
    unittest. Aim for high code coverage but focus on testing critical paths
    and edge cases. Use fixtures to set up test data and mock external dependencies.
    """
    
    team = LibrarianAgentsTeam()
    
    request = """
    Restructure this content into a well-organized guide with:
    1. A clear hierarchical structure (main sections and subsections)
    2. Code examples for each best practice (create realistic examples)
    3. "Do" and "Don't" examples where appropriate
    4. A summary checklist at the end
    
    Make it easy to scan and reference.
    """
    
    result = team.process_document(request, document)
    print(result)

def example_4_multi_chunk_processing():
    """Example: Processing a document that requires chunking"""
    
    print("\n\n" + "="*80)
    print("EXAMPLE 4: Multi-Chunk Processing")
    print("="*80 + "\n")
    
    # Create a very large document
    large_doc = """
    COMPREHENSIVE GUIDE TO CLOUD COMPUTING
    
    """ + "\n\n".join([f"""
    SECTION {i}: Cloud Computing Concept {i}
    
    This section covers important aspects of cloud computing concept number {i}.
    Cloud computing has revolutionized how organizations deploy and manage IT infrastructure.
    
    Key points for concept {i}:
    - Point A: Infrastructure considerations and best practices
    - Point B: Security implications and mitigation strategies
    - Point C: Cost optimization techniques and tools
    - Point D: Performance monitoring and optimization methods
    - Point E: Scalability patterns and anti-patterns
    
    Implementation details: Organizations implementing this concept should consider
    the following factors: team expertise, budget constraints, timeline requirements,
    compliance needs, and existing infrastructure. Each of these factors influences
    the approach and tooling selected.
    
    Case study: A major enterprise in the {['financial', 'healthcare', 'retail', 'manufacturing', 'technology'][i % 5]}
    sector successfully implemented this concept, achieving {i * 10}% improvement in
    operational efficiency and {i * 5}% cost reduction over 12 months.
    """ for i in range(1, 21)])  # 20 sections
    
    team = LibrarianAgentsTeam()
    chunker = DocumentChunker(max_chunk_size=3000)
    
    # Chunk the document
    chunks = chunker.chunk_by_sections(large_doc)
    print(f"Document chunked into {len(chunks)} parts")
    
    request = """
    Analyze this cloud computing guide and provide:
    1. A table of contents with brief descriptions
    2. Common themes across all sections
    3. Top 5 most important takeaways
    4. A comparison table of case studies mentioned
    """
    
    result = team.process_document(request, large_doc)
    print(result)

def example_5_interactive_clarification():
    """Example: Handling clarification requests"""
    
    print("\n\n" + "="*80)
    print("EXAMPLE 5: Interactive Clarification")
    print("="*80 + "\n")
    
    document = """
    PROJECT TIMELINE
    
    Our project has several phases. Phase 1 involves initial setup and planning.
    Phase 2 includes development work. Phase 3 is testing. Phase 4 is deployment.
    
    Each phase has different team members involved and different deliverables.
    The project runs from January to December.
    """
    
    team = LibrarianAgentsTeam()
    
    # This might trigger a clarification request
    request = """
    Create a detailed project timeline table with all the information available.
    """
    
    result = team.process_document(request, document)
    print(result)
    
    # If clarification is needed, the agents will ask
    if "clarification" in result.lower() or "specify" in result.lower():
        print("\n[SYSTEM] Agent requested clarification. Providing additional details...\n")
        
        clarification = """
        Phase 1: Jan-Feb (Sarah, John) - Requirements doc, Architecture design
        Phase 2: Mar-Jun (Full team) - Backend API, Frontend UI, Database schema
        Phase 3: Jul-Sep (QA team) - Unit tests, Integration tests, UAT
        Phase 4: Oct-Dec (DevOps) - Staging deploy, Production deploy, Monitoring setup
        """
        
        final_result = team.answer_clarification(clarification)
        print(final_result)

def example_6_comparison_analysis():
    """Example: Comparative analysis across document sections"""
    
    print("\n\n" + "="*80)
    print("EXAMPLE 6: Comparison Analysis")
    print("="*80 + "\n")
    
    document = """
    PRODUCT COMPARISON ANALYSIS
    
    Product A Features:
    Product A is our premium offering designed for enterprise clients. It includes
    advanced analytics, 24/7 support, unlimited users, SSO integration, API access,
    custom reporting, and dedicated account management. Pricing is $999/month.
    Performance metrics show 99.9% uptime and response times under 100ms.
    
    Product B Features:
    Product B targets small to medium businesses. It offers standard analytics,
    business hours support, up to 50 users, basic reporting, and email support.
    Pricing is $199/month. Performance shows 99.5% uptime and response times
    around 200ms.
    
    Product C Features:
    Product C is our entry-level solution for startups and individuals. Features
    include basic analytics, community support, up to 10 users, and pre-built
    reports. Pricing is $49/month. Performance metrics indicate 99% uptime and
    response times of 300ms.
    """
    
    team = LibrarianAgentsTeam()
    
    request = """
    Create a comprehensive comparison of all three products:
    
    1. A detailed comparison table with rows for each feature category:
       - User Capacity
       - Analytics Capabilities  
       - Support Level
       - Reporting Features
       - Performance Metrics
       - Pricing
       
    2. A summary analysis identifying:
       - Best value for money
       - Best for enterprise
       - Best for startups
       
    Use HTML tables with merged cells where needed and proper formatting.
    """
    
    result = team.process_document(request, document)
    print(result)

# Main execution
if __name__ == "__main__":
    print("\n")
    print("╔" + "="*78 + "╗")
    print("║" + " "*15 + "LIBRARIAN AGENTS TEAM - ADVANCED EXAMPLES" + " "*22 + "║")
    print("╚" + "="*78 + "╝")
    
    # Run examples
    examples = [
        ("Large Document Summary", example_1_large_document_summary),
        ("Extract Data to Tables", example_2_extract_data_to_table),
        ("Restructure Content", example_3_restructure_content),
        ("Multi-Chunk Processing", example_4_multi_chunk_processing),
        ("Interactive Clarification", example_5_interactive_clarification),
        ("Comparison Analysis", example_6_comparison_analysis)
    ]
    
    print("\nAvailable examples:")
    for i, (name, _) in enumerate(examples, 1):
        print(f"{i}. {name}")
    
    print("\nRunning all examples...")
    print("(In production, you can run individual examples)\n")
    
    for name, example_func in examples:
        try:
            example_func()
        except Exception as e:
            print(f"\n[ERROR] Example '{name}' encountered an error: {e}")
            print("Continuing with next example...\n")
    
    print("\n\n" + "="*80)
    print("All examples completed!")
    print("="*80)
