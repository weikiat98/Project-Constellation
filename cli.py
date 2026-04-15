#!/usr/bin/env python3
"""
Deep-Reading Assistant — Command Line Interface

Repoints to the new async orchestrator engine.
"""

import argparse
import asyncio
import os
import sys
import uuid
from pathlib import Path


def _check_api_key():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set", file=sys.stderr)
        print("Set it with: export ANTHROPIC_API_KEY='your-key'", file=sys.stderr)
        sys.exit(1)


async def _run_async(args):
    from document_loader import DocumentLoader, DocumentSaver
    from backend.orchestrator.event_bus import SessionEventBus
    from backend.orchestrator.lead import run_lead
    from backend.store.sessions import (
        create_session,
        add_message,
        get_chunks_for_document,
    )
    from backend.store.documents import DocumentStore
    from backend.extractors.definitions import extract_definitions
    from backend.extractors.cross_refs import extract_cross_refs

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Create a transient session
    session = await create_session(title=f"CLI: {input_path.name}")
    session_id = session["id"]

    # Ingest document
    print(f"Loading document: {input_path.name} …", file=sys.stderr)
    store = DocumentStore(chunk_size=getattr(args, "chunk_size", 8000))
    result = await store.ingest(session_id, str(input_path))
    print(
        f"Ingested {result['chunk_count']} chunks "
        f"({result.get('page_count', '?')} pages)",
        file=sys.stderr,
    )

    # Run extractors
    chunks = await get_chunks_for_document(result["document_id"])
    defns = await extract_definitions(result["document_id"], chunks)
    xrefs = await extract_cross_refs(result["document_id"], chunks)
    if defns:
        print(f"Extracted {len(defns)} definitions", file=sys.stderr)
    if xrefs:
        print(f"Detected {len(xrefs)} cross-references", file=sys.stderr)

    audience = getattr(args, "audience", "professional")

    if args.interactive:
        print("\n" + "=" * 60)
        print("Deep-Reading Assistant — Interactive Mode")
        print("=" * 60)
        print(f"Document : {input_path.name}")
        print(f"Chunks   : {result['chunk_count']}")
        print(f"Audience : {audience}")
        print("Type your question or 'quit' to exit")
        print("=" * 60 + "\n")

        while True:
            try:
                request = input("Your question: ").strip()
            except (KeyboardInterrupt, EOFError):
                print("\nGoodbye!")
                break

            if request.lower() in ("quit", "exit", "q"):
                print("Goodbye!")
                break
            if not request:
                continue

            await add_message(session_id, "user", request)

            print("\nProcessing …\n", file=sys.stderr)
            bus = SessionEventBus()

            if args.verbose:
                # Print event trace to stderr
                async def _verbose_consume(b=bus):
                    import json
                    async for line in b.consume():
                        line = line.strip()
                        if line.startswith("data:"):
                            try:
                                ev = json.loads(line[5:])
                                etype = ev.get("type", "")
                                if etype in ("agent_spawned", "tool_use", "artifact_written", "compaction_done"):
                                    print(f"  [event] {line[5:].strip()}", file=sys.stderr)
                            except Exception:
                                pass

                asyncio.create_task(_verbose_consume())

            answer = await run_lead(session_id, request, bus, audience)
            print("\n" + "=" * 60)
            print(answer)
            print("=" * 60 + "\n")

            if args.output:
                output_path = Path(args.output)
                with open(output_path, "a", encoding="utf-8") as f:
                    f.write(f"\n## Question\n{request}\n\n## Answer\n{answer}\n\n")
                print(f"Appended to {args.output}", file=sys.stderr)
    else:
        if not args.request:
            print("Error: --request is required in non-interactive mode", file=sys.stderr)
            sys.exit(1)

        await add_message(session_id, "user", args.request)
        print("Processing …\n", file=sys.stderr)

        bus = SessionEventBus()
        answer = await run_lead(session_id, args.request, bus, audience)

        if args.output:
            output_path = Path(args.output)
            saver = DocumentSaver()
            ext = output_path.suffix.lower()
            if ext == ".html":
                saver.save_html(answer, str(output_path), title=input_path.stem)
            else:
                saver.save_text(answer, str(output_path))
            print(f"Saved to {args.output}", file=sys.stderr)
        else:
            print(answer)


def main():
    parser = argparse.ArgumentParser(
        description="Deep-Reading Assistant — intelligent document analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cli.py -i regulation.pdf -r "What obligations does this impose on small businesses?"
  python cli.py -i policy.pdf --interactive --audience layperson
  python cli.py -i act.pdf -r "Summarise Part 3" -o summary.md
        """,
    )

    parser.add_argument("-i", "--input", required=True, help="Path to input document")
    parser.add_argument("-r", "--request", help="Question/instruction for the agent")
    parser.add_argument("-o", "--output", help="Save answer to this file")
    parser.add_argument("--chunk-size", type=int, default=8000, help="Max chunk size (chars)")
    parser.add_argument("--interactive", action="store_true", help="Interactive Q&A mode")
    parser.add_argument("--verbose", action="store_true", help="Show agent event trace")
    parser.add_argument(
        "--audience",
        choices=["layperson", "professional", "expert"],
        default="professional",
        help="Explanation depth (default: professional)",
    )

    args = parser.parse_args()
    _check_api_key()
    asyncio.run(_run_async(args))


if __name__ == "__main__":
    main()
