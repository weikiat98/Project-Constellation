"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Square, User, Bot } from "lucide-react";
import type { Message, Artifact } from "@/lib/api";
import CitationLink from "./CitationLink";
import ArtifactCard from "./ArtifactCard";

// Regex: matches [uuid-v4-style] inline citations
const CITATION_RE = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;

function renderWithCitations(text: string, onCitation: (id: string) => void) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;

  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <CitationLink key={match.index} chunkId={match[1]} onClick={onCitation} />
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  artifacts: Artifact[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onCitationClick: (chunkId: string) => void;
}

export default function ChatPane({
  messages,
  streamingText,
  artifacts,
  isStreaming,
  onSend,
  onStop,
  onCitationClick,
}: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  function submit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-600 text-sm pt-16">
            Upload a document, then ask a question.
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4 text-blue-400" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-sm"
                  : "bg-[#1a1d27] text-slate-200 rounded-tl-sm"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => (
                        <p>
                          {typeof children === "string"
                            ? renderWithCitations(children, onCitationClick)
                            : children}
                        </p>
                      ),
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
                <User className="w-4 h-4 text-slate-300" />
              </div>
            )}
          </div>
        ))}

        {/* Streaming response */}
        {isStreaming && streamingText && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="max-w-[85%] bg-[#1a1d27] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-slate-200">
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
              <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}

        {/* Artifacts inline */}
        {artifacts.length > 0 && (
          <div className="space-y-2 pl-10">
            <p className="text-xs text-slate-500 font-medium">Generated artifacts</p>
            {artifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#2d3148]">
        <div className="flex items-end gap-2 bg-[#1a1d27] rounded-xl px-3 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Ask a question about the document…"
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 resize-none outline-none leading-relaxed max-h-32 overflow-y-auto disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition shrink-0"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition shrink-0 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
