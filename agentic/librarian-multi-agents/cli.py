#!/usr/bin/env python3
"""
Librarian Agents Team - Command Line Interface
Easy-to-use CLI for document processing
"""

import argparse, sys, os
from pathlib import Path

from librarian_agents_team import LibrarianAgentsTeam
from document_loader import DocumentLoader, DocumentSaver
from document_chunker import DocumentChunker

def main():
    parser = argparse.ArgumentParser(
        description='Librarian Agents Team - Intelligent Document Processing',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Summarize a document
  python cli.py -i document.pdf -r "Create a 2-page summary" -o summary.txt
  
  # Extract data to tables
  python cli.py -i report.docx -r "Extract all data into comparison tables" -o tables.html
  
  # Process with custom instructions
  python cli.py -i book.txt -r "Analyze themes and create chapter breakdown" -o analysis.md
  
  # Interactive mode
  python cli.py -i document.pdf --interactive

Supported input formats: .txt, .md, .pdf, .docx, .html
Supported output formats: .txt, .md, .html, .docx
        """
    )
    
    # Input arguments
    parser.add_argument(
        '-i', '--input',
        type=str,
        required=True,
        help='Path to input document'
    )
    
    parser.add_argument(
        '-r', '--request',
        type=str,
        help='Processing request/instruction for the agents'
    )
    
    parser.add_argument(
        '-o', '--output',
        type=str,
        help='Path to output file (optional, defaults to stdout)'
    )
    
    # Processing options
    parser.add_argument(
        '--chunk-size',
        type=int,
        default=8000,
        help='Maximum chunk size for document processing (default: 8000)'
    )
    
    parser.add_argument(
        '--interactive',
        action='store_true',
        help='Interactive mode - allows follow-up questions'
    )
    
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Verbose output - show agent activity'
    )
    
    parser.add_argument(
        '--metadata',
        action='store_true',
        help='Extract and display document metadata'
    )
    
    args = parser.parse_args()
    
    # Validate input file
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)
    
    # Check API key
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print("❌ Error: ANTHROPIC_API_KEY environment variable not set", file=sys.stderr)
        print("Set it with: export ANTHROPIC_API_KEY='your-key'", file=sys.stderr)
        sys.exit(1)
    
    # Load document
    print("📄 Loading document...", file=sys.stderr)
    try:
        loader = DocumentLoader()
        doc_data = loader.load_document(str(input_path))
        content = doc_data.get('content', '')
        
        if args.verbose:
            print(f"✓ Loaded {len(content)} characters", file=sys.stderr)
            if 'page_count' in doc_data:
                print(f"✓ Document has {doc_data['page_count']} pages", file=sys.stderr)
        
        if args.metadata and 'metadata' in doc_data:
            print("\n📊 Document Metadata:", file=sys.stderr)
            for key, value in doc_data['metadata'].items():
                print(f"  {key}: {value}", file=sys.stderr)
            print()
        
    except Exception as e:
        print(f"❌ Error loading document: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Initialize agents team
    if args.verbose:
        print("🤖 Initializing Librarian Agents Team...", file=sys.stderr)
    
    team = LibrarianAgentsTeam()
    
    # Interactive mode
    if args.interactive:
        print("\n" + "="*60)
        print("Interactive Mode - Librarian Agents Team")
        print("="*60)
        print("Document loaded successfully!")
        print(f"Document: {input_path.name}")
        print(f"Size: {len(content)} characters")
        print("\nType your request or 'quit' to exit")
        print("Type 'continue' to continue a previous response")
        print("="*60 + "\n")
        
        while True:
            try:
                request = input("Your request: ").strip()
                
                if request.lower() in ['quit', 'exit', 'q']:
                    print("\nGoodbye! 👋")
                    break
                
                if not request:
                    continue
                
                if request.lower() == 'continue':
                    print("\n🤖 Processing continuation...\n")
                    result = team.continue_processing()
                else:
                    print("\n🤖 Processing request...\n")
                    result = team.process_document(request, content)
                
                print("\n" + "="*60)
                print("RESULT")
                print("="*60 + "\n")
                print(result)
                print("\n" + "="*60 + "\n")
                
                # Ask if user wants to save
                save = input("Save this result? (y/N): ").strip().lower()
                if save == 'y':
                    output_file = input("Output file path: ").strip()
                    if output_file:
                        with open(output_file, 'w', encoding='utf-8') as f:
                            f.write(result)
                        print(f"✓ Saved to {output_file}")
                
            except KeyboardInterrupt:
                print("\n\nInterrupted. Goodbye! 👋")
                break
            except Exception as e:
                print(f"\n❌ Error: {e}\n", file=sys.stderr)
    
    # Single request mode
    else:
        if not args.request:
            print("❌ Error: --request is required in non-interactive mode", file=sys.stderr)
            print("Use --interactive for interactive mode", file=sys.stderr)
            sys.exit(1)
        
        if args.verbose:
            print(f"📝 Request: {args.request}", file=sys.stderr)
            print("🤖 Processing...\n", file=sys.stderr)
        
        try:
            result = team.process_document(args.request, content)
            
            # Output result
            if args.output:
                output_path = Path(args.output)
                output_ext = output_path.suffix.lower()
                
                # Save based on file extension
                saver = DocumentSaver()
                
                if output_ext == '.html':
                    saver.save_html(result, str(output_path), title=input_path.stem)
                elif output_ext == '.docx':
                    saver.save_to_docx(result, str(output_path), title=input_path.stem)
                else:
                    saver.save_text(result, str(output_path))
                
                if args.verbose:
                    print(f"\n✓ Result saved to {args.output}", file=sys.stderr)
                else:
                    print(f"✓ Saved to {args.output}")
            else:
                # Print to stdout
                print(result)
            
        except Exception as e:
            print(f"❌ Error processing document: {e}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
