"""
Test Example - Complete Workflow Demo
Demonstrates the full capability of the Librarian Agents Team
"""

import os
from librarian_agents_team import LibrarianAgentsTeam
from document_chunker import DocumentChunker
from document_loader import DocumentLoader, DocumentSaver

def create_sample_document():
    """Create a sample large document for testing"""
    
    document = """
COMPREHENSIVE GUIDE TO SUSTAINABLE BUSINESS PRACTICES
A Multi-Chapter Analysis of Modern Corporate Responsibility

=== TABLE OF CONTENTS ===

Chapter 1: Introduction to Sustainable Business
Chapter 2: Environmental Impact and Carbon Footprint
Chapter 3: Social Responsibility and Ethics
Chapter 4: Economic Sustainability Models
Chapter 5: Implementation Strategies
Chapter 6: Case Studies and Success Stories
Chapter 7: Measuring and Reporting Impact
Chapter 8: Future Trends and Predictions

--- Page 1 ---

CHAPTER 1: INTRODUCTION TO SUSTAINABLE BUSINESS

1.1 Defining Sustainability in Business Context

Sustainable business practices represent a fundamental shift in how organizations 
approach their operations, stakeholder relationships, and long-term value creation. 
The concept extends beyond simple environmental protection to encompass a holistic 
view of business impact across environmental, social, and economic dimensions - 
commonly referred to as the "triple bottom line."

Modern sustainability frameworks recognize that businesses operate within complex 
ecosystems where their actions have far-reaching consequences. A sustainable 
business seeks to create positive outcomes for all stakeholders: shareholders, 
employees, customers, communities, and the environment itself.

1.2 Historical Evolution

The sustainability movement in business has evolved significantly since the 1970s:

1970s: Early environmental regulations emerge, primarily focused on pollution control
1980s: Corporate social responsibility (CSR) concepts gain traction
1990s: Introduction of triple bottom line framework by John Elkington
2000s: Rise of ESG (Environmental, Social, Governance) investing
2010s: Paris Agreement drives corporate climate commitments
2020s: Net-zero targets and stakeholder capitalism become mainstream

1.3 Why Sustainability Matters Today

Several factors drive the urgency of sustainable business practices:

Climate Change: Scientific consensus shows unprecedented warming requiring immediate action
Resource Scarcity: Finite natural resources demand efficient, circular economy approaches
Stakeholder Expectations: Consumers, employees, and investors increasingly prioritize sustainability
Regulatory Pressure: Governments worldwide implementing stricter environmental and social standards
Business Risk: Climate-related risks pose material threats to business continuity and valuation

--- Page 2 ---

CHAPTER 2: ENVIRONMENTAL IMPACT AND CARBON FOOTPRINT

2.1 Understanding Carbon Footprint

A carbon footprint measures the total greenhouse gas emissions caused directly and 
indirectly by an organization, expressed as carbon dioxide equivalents (CO2e). 
Comprehensive carbon accounting covers three scopes:

Scope 1: Direct emissions from owned or controlled sources (e.g., company vehicles, facilities)
Scope 2: Indirect emissions from purchased energy (electricity, heating, cooling)
Scope 3: All other indirect emissions in the value chain (suppliers, transportation, product use)

Industry-specific carbon footprints vary significantly:

Technology sector: 100-500 kg CO2e per employee annually (primarily Scope 2 & 3)
Manufacturing: 5,000-50,000 kg CO2e per employee annually (significant Scope 1)
Transportation: 10,000-100,000 kg CO2e per employee annually (high Scope 1)
Finance: 50-200 kg CO2e per employee annually (primarily Scope 3)

2.2 Reduction Strategies

Effective carbon reduction requires systematic approaches across all operations:

Energy Efficiency: LED lighting, HVAC optimization, building insulation can reduce energy use 20-40%
Renewable Energy: Solar, wind, or renewable energy credits eliminate Scope 2 emissions
Supply Chain Optimization: Working with suppliers to reduce Scope 3 emissions through efficiency gains
Transportation Electrification: Electric vehicles reduce operational emissions by 60-80%
Carbon Offsets: High-quality offsets can address hard-to-eliminate emissions

2.3 Water and Resource Management

Beyond carbon, comprehensive environmental management addresses:

Water Usage: Industrial processes, cooling systems, and facility operations
Waste Generation: Manufacturing waste, office waste, product packaging
Biodiversity Impact: Land use, habitat protection, ecosystem services
Pollution Control: Air quality, water discharge, soil contamination

--- Page 3 ---

CHAPTER 3: SOCIAL RESPONSIBILITY AND ETHICS

3.1 Labor Practices and Human Rights

Ethical business practices prioritize fair treatment of all workers:

Fair Wages: Compensation that provides living wage standards, not just minimum wage
Safe Working Conditions: Zero tolerance for workplace hazards, comprehensive safety programs
Diversity and Inclusion: Representative workforce across all levels, equitable opportunities
Freedom of Association: Support for worker rights to organize and collectively bargain

Supply chain labor practices require particular attention. Companies must ensure 
their suppliers meet the same ethical standards, conducting regular audits and 
maintaining transparency about supply chain conditions.

3.2 Community Engagement

Responsible businesses actively contribute to communities:

Local Economic Development: Hiring locally, supporting local suppliers, investing in infrastructure
Education and Training: Skills development programs, scholarships, partnerships with educational institutions
Health and Wellness: Healthcare access, wellness programs, public health initiatives
Philanthropic Giving: Strategic charitable contributions aligned with business expertise

3.3 Customer Welfare

Ethical treatment of customers encompasses:

Product Safety: Rigorous testing, quality control, prompt recall procedures
Transparent Marketing: Honest advertising, clear product information, no deceptive practices
Data Privacy: Strong data protection, transparent data policies, user control over information
Accessibility: Products and services designed for diverse populations including disabled individuals

--- Page 4 ---

CHAPTER 4: ECONOMIC SUSTAINABILITY MODELS

4.1 Circular Economy Principles

The circular economy represents a shift from the traditional linear "take-make-dispose" 
model to one where resources circulate continuously:

Design for Longevity: Products built to last, modular design enabling repairs
Resource Recovery: End-of-life collection, refurbishment, remanufacturing
Material Recycling: Closed-loop systems where waste becomes input for new production
Sharing Economy: Collaborative consumption models maximizing asset utilization

Implementation requires rethinking entire business models:

Product-as-a-Service: Companies retain ownership, customers pay for usage (e.g., lighting-as-a-service)
Take-back Programs: Manufacturers recover products for recycling or refurbishment
Industrial Symbiosis: One company's waste becomes another's input material

4.2 Sustainable Value Creation

Long-term value creation requires balancing multiple objectives:

Shareholder Returns: Maintaining profitability and delivering competitive returns
Stakeholder Value: Creating benefits for employees, customers, communities, environment
Innovation Investment: R&D in sustainable technologies and practices
Resilience Building: Preparing for climate risks, supply chain disruptions, regulatory changes

Research shows that companies with strong ESG performance often outperform peers:

Lower Cost of Capital: 0.5-1% reduction in borrowing costs for high ESG performers
Revenue Growth: Sustainability-linked products growing 5-6x faster than conventional
Risk Mitigation: Fewer regulatory fines, lawsuits, and operational disruptions
Talent Attraction: 70% of workers prefer employers with strong sustainability commitments

4.3 Impact Investing and ESG Metrics

Financial markets increasingly integrate sustainability:

ESG Ratings: MSCI, Sustainalytics, and others rate companies on sustainability performance
Impact Funds: Investment vehicles explicitly targeting environmental/social outcomes alongside returns
Green Bonds: Debt instruments financing environmentally beneficial projects
Shareholder Activism: Investors pressuring companies on climate and social issues

--- Page 5 ---

CHAPTER 5: IMPLEMENTATION STRATEGIES

5.1 Organizational Change Management

Successful sustainability implementation requires systematic change:

Leadership Commitment: C-suite and board-level champions driving transformation
Cross-functional Teams: Sustainability integrated across departments, not siloed
Employee Engagement: Training, incentives, and empowerment for all staff
Culture Shift: Values and behaviors aligned with sustainability goals

Change management principles include:

Clear Vision: Articulating compelling sustainability goals and rationale
Communication: Regular updates on progress, challenges, and opportunities
Quick Wins: Early successes building momentum and demonstrating value
Persistence: Sustainability transformation takes years, requiring sustained commitment

5.2 Technology and Innovation

Technology enables sustainability at scale:

IoT and Sensors: Real-time monitoring of energy, water, emissions, waste
AI and Analytics: Optimization of operations, predictive maintenance, supply chain efficiency
Blockchain: Supply chain transparency, verification of sustainable sourcing
Clean Technology: Solar, wind, battery storage, hydrogen, carbon capture

Innovation examples:

Agriculture: Precision farming reduces water, fertilizer use by 20-30%
Buildings: Smart HVAC, lighting systems cut energy consumption 30-50%
Manufacturing: Process optimization reduces waste, improves yield
Transportation: Route optimization, electric fleets lower emissions 40-70%

5.3 Stakeholder Engagement

Effective sustainability requires collaboration:

Supplier Partnerships: Working together on efficiency, emissions reduction
Customer Education: Helping customers maximize product sustainability benefits
NGO Collaboration: Partnering with environmental, social organizations
Industry Initiatives: Sector-wide standards, knowledge sharing, collective action

--- Page 6 ---

CHAPTER 6: CASE STUDIES AND SUCCESS STORIES

6.1 Manufacturing Excellence: Interface Inc.

Background: Global modular flooring manufacturer
Challenge: High carbon footprint, resource-intensive production
Approach: "Mission Zero" - eliminate environmental impact by 2020

Key Actions:
- Redesigned products using recycled and bio-based materials
- Converted to 100% renewable energy in manufacturing
- Implemented carpet take-back and recycling program
- Innovated manufacturing processes reducing waste by 91%

Results:
- Reduced absolute carbon emissions 96% (1996-2020)
- Saved $450 million in costs through efficiency improvements
- Achieved carbon negative operations by 2020
- Became industry leader inspiring competitors

Lessons: Bold goals, comprehensive approach, innovation focus, persistence over decades

6.2 Technology Leadership: Microsoft

Background: Global technology and cloud services provider
Challenge: Massive and growing data center energy consumption
Approach: Carbon negative by 2030, remove historical emissions by 2050

Key Actions:
- $1 billion Climate Innovation Fund for clean technology
- Carbon fee on business units driving internal accountability
- Renewable energy deals powering 100% of operations
- Purchased carbon removal credits exceeding emissions
- Developed sustainability tools for customers

Results:
- Reduced carbon emissions 17% while revenue grew 40% (2020-2024)
- Pioneered corporate carbon removal commitments
- Influenced industry-wide climate action
- Demonstrated financial and environmental alignment

Lessons: Financial commitment, internal incentives, technology leverage, industry leadership

6.3 Retail Innovation: Patagonia

Background: Outdoor clothing and gear company
Challenge: Fashion industry's environmental and social impact
Approach: Build best product, cause no unnecessary harm, use business to protect nature

Key Actions:
- Fair Trade certification for 100% apparel production
- Organic cotton exclusively since 1996
- Worn Wear program encouraging repair, reuse, recycling
- 1% for the Planet - donating 1% of sales to environmental organizations
- Activism funding environmental campaigns

Results:
- Sustained profitability while prioritizing environmental/social goals
- Customer loyalty and brand value through authentic commitment
- Influenced fashion industry toward sustainability
- B Corp certification recognizing comprehensive impact

Lessons: Authenticity, long-term commitment, stakeholder primacy, values-driven decisions

--- Page 7 ---

CHAPTER 7: MEASURING AND REPORTING IMPACT

7.1 Sustainability Metrics and KPIs

Comprehensive measurement requires diverse indicators:

Environmental Metrics:
- Carbon emissions (Scope 1, 2, 3) per unit revenue
- Energy consumption and renewable energy percentage
- Water usage and water stress exposure
- Waste generation and diversion rates
- Biodiversity impact assessments

Social Metrics:
- Employee diversity across demographics and levels
- Pay equity ratios and living wage compliance
- Employee turnover and satisfaction scores
- Safety incidents and lost time injury rates
- Community investment as percentage of profit
- Supply chain audit results

Governance Metrics:
- Board diversity and independence
- Executive compensation linked to ESG performance
- Political spending and lobbying disclosure
- Ethics violations and penalties
- Sustainability report external assurance

7.2 Reporting Frameworks

Multiple frameworks guide sustainability disclosure:

GRI (Global Reporting Initiative): Comprehensive, widely adopted, stakeholder-focused
SASB (Sustainability Accounting Standards Board): Financially material, industry-specific
TCFD (Task Force on Climate-related Financial Disclosures): Climate risk focus, investor-oriented
CDP (Carbon Disclosure Project): Environmental data, benchmarking emphasis
Integrated Reporting: Financial and sustainability performance combined

Best practices for reporting:

Materiality Assessment: Focus on issues most significant to business and stakeholders
Data Quality: Robust measurement systems, external verification
Transparency: Honest about challenges, not just successes
Comparability: Consistent metrics enabling year-over-year tracking
Accessibility: Clear, understandable communication for diverse audiences

7.3 External Verification and Assurance

Third-party assurance enhances credibility:

Limited Assurance: Basic verification of reporting processes and claims
Reasonable Assurance: Comprehensive audit similar to financial statements
Certification: Industry-specific standards (B Corp, Cradle-to-Cradle, etc.)

--- Page 8 ---

CHAPTER 8: FUTURE TRENDS AND PREDICTIONS

8.1 Emerging Sustainability Priorities

Next-generation sustainability focuses on:

Nature Positive: Moving beyond carbon to address biodiversity, ecosystem restoration
Circular Economy: Systematic elimination of waste, closed-loop materials flows
Supply Chain Decarbonization: Scope 3 emissions reduction at scale
Climate Adaptation: Preparing operations and communities for climate impacts
Just Transition: Ensuring equitable treatment of workers and communities affected by sustainability changes

8.2 Technology Evolution

Coming innovations will accelerate sustainability:

Artificial Intelligence: Optimizing energy grids, agriculture, manufacturing at unprecedented scale
Advanced Materials: Carbon-negative concrete, sustainable plastics, high-performance recycled materials
Energy Storage: Long-duration batteries enabling 100% renewable energy
Carbon Removal: Direct air capture, enhanced mineralization scaling up
Synthetic Biology: Sustainable alternatives to petroleum-based products

8.3 Policy and Regulation

Government action will intensify:

Carbon Pricing: More countries implementing carbon taxes or cap-and-trade
Mandatory Disclosure: Climate and sustainability reporting becoming standard
Product Standards: Restrictions on single-use plastics, efficiency requirements
Supply Chain Due Diligence: Legal liability for supply chain human rights, environmental violations
Green Industrial Policy: Subsidies and incentives for clean technology, manufacturing

8.4 Business Model Innovation

Sustainability driving new business approaches:

Regenerative Business: Companies actively restoring ecosystems, communities
Stakeholder Capitalism: Explicit consideration of all stakeholders in corporate governance
Platform Cooperatives: Worker-owned platforms addressing gig economy challenges
Doughnut Economics: Operating within ecological ceiling and social foundation

8.5 Call to Action

The transition to sustainable business is urgent and achievable. Success requires:

Bold Leadership: Setting ambitious goals and committing resources
Systemic Thinking: Addressing root causes, not just symptoms
Collaboration: Working across sectors, industries, borders
Innovation: Embracing new technologies, business models, practices
Persistence: Maintaining commitment through challenges and setbacks

The businesses that thrive in the coming decades will be those that embrace 
sustainability not as a constraint but as an opportunity - to innovate, to create 
value, to build resilience, and to contribute to a flourishing planet and society.

The time for incremental change has passed. The future demands transformation.

=== END OF DOCUMENT ===

APPENDIX A: Key Terms and Definitions

Carbon Footprint: Total greenhouse gas emissions caused by an organization, product, or activity
Circular Economy: Economic system eliminating waste through continuous cycling of resources
ESG: Environmental, Social, and Governance factors used to evaluate corporate responsibility
Greenwashing: Misleading claims about environmental benefits of products or practices
Life Cycle Assessment: Analysis of environmental impacts throughout a product's entire life
Net Zero: Balancing greenhouse gas emissions with removal from atmosphere
Renewable Energy: Energy from sources that naturally replenish (solar, wind, hydro)
Scope 1/2/3 Emissions: Classification system for greenhouse gas emissions
Stakeholder Capitalism: Business philosophy prioritizing all stakeholders, not just shareholders
Triple Bottom Line: Framework measuring performance across profit, people, planet

APPENDIX B: Recommended Resources

Books:
- "The Ecology of Commerce" by Paul Hawken
- "Cradle to Cradle" by William McDonough and Michael Braungart
- "Let My People Go Surfing" by Yvon Chouinard
- "Doughnut Economics" by Kate Raworth

Organizations:
- World Business Council for Sustainable Development (WBCSD)
- Ceres
- B Lab (B Corporation)
- Ellen MacArthur Foundation (Circular Economy)

Reports:
- IPCC Climate Reports
- UN Global Compact Progress Reports
- World Economic Forum Global Risks Report
"""
    
    return document

def run_comprehensive_test():
    """Run a comprehensive test of all agent capabilities"""
    
    print("\n" + "="*80)
    print("LIBRARIAN AGENTS TEAM - COMPREHENSIVE TEST")
    print("="*80 + "\n")
    
    # Create sample document
    print("📝 Creating sample document (8 chapters, ~15 pages)...")
    document = create_sample_document()
    print(f"✓ Document created: {len(document)} characters\n")
    
    # Save sample document for reference
    saver = DocumentSaver()
    saver.save_text(document, '/tmp/sample_sustainability_guide.txt')
    print("✓ Sample saved to: /tmp/sample_sustainability_guide.txt\n")
    
    # Initialize team
    print("🤖 Initializing Librarian Agents Team...\n")
    team = LibrarianAgentsTeam()
    
    # Test 1: Executive Summary
    print("="*80)
    print("TEST 1: Executive Summary Generation")
    print("="*80 + "\n")
    
    request1 = """
    Create a comprehensive 1-page executive summary of this guide that includes:
    1. Brief overview of each chapter
    2. Key themes across the document
    3. Most important takeaways for business leaders
    """
    
    print("Processing...")
    result1 = team.process_document(request1, document)
    print("\n[RESULT]")
    print(result1)
    print("\n" + "="*80 + "\n")
    
    # Save result
    saver.save_text(result1, '/tmp/test1_executive_summary.txt')
    print("✓ Saved to: /tmp/test1_executive_summary.txt\n")
    
    # Test 2: Data Extraction and Table Generation
    print("="*80)
    print("TEST 2: Data Extraction and Table Generation")
    print("="*80 + "\n")
    
    request2 = """
    Extract key information and create the following tables:
    
    1. Historical Timeline Table:
       - Columns: Decade, Key Developments, Impact
       - Extract from Chapter 1
       - Use HTML format with merged cells for multi-year periods
    
    2. Case Studies Comparison Table:
       - Columns: Company, Industry, Challenge, Approach, Results, Key Lesson
       - Extract from Chapter 6
       - Use HTML format with proper styling
    
    3. Sustainability Metrics Table:
       - Group by Environmental, Social, Governance categories
       - Include specific metrics from Chapter 7
       - Use HTML with category headers using merged cells
    """
    
    print("Processing...")
    result2 = team.process_document(request2, document)
    print("\n[RESULT]")
    print(result2)
    print("\n" + "="*80 + "\n")
    
    # Save result
    saver.save_html(result2, '/tmp/test2_tables.html', title="Sustainability Guide - Data Tables")
    print("✓ Saved to: /tmp/test2_tables.html\n")
    
    # Test 3: Content Restructuring
    print("="*80)
    print("TEST 3: Content Restructuring for Different Audience")
    print("="*80 + "\n")
    
    request3 = """
    Restructure Chapter 5 (Implementation Strategies) for a startup founder audience:
    
    1. Simplify technical content
    2. Add practical "Getting Started" steps
    3. Include cost estimates where applicable
    4. Create a 90-day action plan
    5. Format with clear sections, bullet points, and emphasis on actionable items
    """
    
    print("Processing...")
    result3 = team.process_document(request3, document)
    print("\n[RESULT]")
    print(result3)
    print("\n" + "="*80 + "\n")
    
    # Save result
    saver.save_markdown(result3, '/tmp/test3_startup_guide.md')
    print("✓ Saved to: /tmp/test3_startup_guide.md\n")
    
    # Test 4: Comparative Analysis
    print("="*80)
    print("TEST 4: Comparative Analysis")
    print("="*80 + "\n")
    
    request4 = """
    Compare and contrast the three case studies from Chapter 6:
    
    1. Create a detailed comparison analyzing:
       - Industry differences and challenges
       - Approaches and strategies
       - Results and impact
       - Scalability and replicability
    
    2. Generate an HTML comparison table with:
       - Side-by-side comparison of all three companies
       - Color-coded cells for performance levels
       - Merged cells for common themes
    
    3. Provide strategic recommendations based on the comparison
    """
    
    print("Processing...")
    result4 = team.process_document(request4, document)
    print("\n[RESULT]")
    print(result4)
    print("\n" + "="*80 + "\n")
    
    # Save result
    saver.save_html(result4, '/tmp/test4_case_study_comparison.html', 
                    title="Case Study Comparison Analysis")
    print("✓ Saved to: /tmp/test4_case_study_comparison.html\n")
    
    # Summary
    print("="*80)
    print("TEST SUMMARY")
    print("="*80 + "\n")
    
    print("✅ All tests completed successfully!")
    print("\nGenerated outputs:")
    print("  1. /tmp/test1_executive_summary.txt")
    print("  2. /tmp/test2_tables.html")
    print("  3. /tmp/test3_startup_guide.md")
    print("  4. /tmp/test4_case_study_comparison.html")
    print("\nOriginal document:")
    print("  - /tmp/sample_sustainability_guide.txt")
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    # Check for API key
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print("❌ Error: ANTHROPIC_API_KEY environment variable not set")
        print("Set it with: export ANTHROPIC_API_KEY='your-api-key-here'")
        exit(1)
    
    run_comprehensive_test()
