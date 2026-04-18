"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Square,
  User,
  Bot,
  Plus,
  Upload,
  Copy,
  Check,
  RotateCcw,
  Pencil,
  Search,
  X,
  FileText,
} from "lucide-react";
import type { Artifact, Document } from "@/lib/api";
import CitationLink from "./CitationLink";
import ArtifactCard from "./ArtifactCard";
import ContextMeter from "./ContextMeter";
import AgentTracePanel from "./AgentTracePanel";
import type { TraceEntry } from "./AgentTrace";

// Match a citation block: one or more UUIDs separated by `,` `;` or whitespace
// inside square brackets. e.g. [uuid], [uuid, uuid], [uuid; uuid].
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CITATION_RE = new RegExp(`\\[(${UUID}(?:\\s*[,;]\\s*${UUID})*)\\]`, "g");
const UUID_RE = new RegExp(UUID, "g");

function injectCitations(nodes: React.ReactNode, onCitation: (id: string) => void): React.ReactNode {
  // Walk a React children tree and replace `[<uuid>(, <uuid>)*]` substrings
  // inside text nodes with one or more <CitationLink/> elements. Preserves
  // inline markdown formatting (bold, italic, links) around the citations.
  const replaceInString = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    CITATION_RE.lastIndex = 0;
    while ((match = CITATION_RE.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const ids = match[1].match(UUID_RE) ?? [];
      ids.forEach((id, i) => {
        parts.push(
          <CitationLink key={`${keyPrefix}-${match!.index}-${i}`} chunkId={id} onClick={onCitation} />
        );
      });
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  if (typeof nodes === "string") return replaceInString(nodes, "s");
  if (Array.isArray(nodes)) {
    return nodes.flatMap((n, i) =>
      typeof n === "string" ? replaceInString(n, `a${i}`) : [n]
    );
  }
  return nodes;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  attachedDocs?: string[]; // user-facing filenames attached when this message was sent
}

interface Props {
  sessionId: string;
  messages: ChatMessage[];
  streamingText: string;
  artifacts: Artifact[];
  documents: Document[];
  isStreaming: boolean;
  onSend: (text: string, attachedDocs: string[]) => void;
  onStop: () => void;
  onCitationClick: (chunkId: string) => void;
  onUploadClick: () => void;
  onArtifactPreview?: (artifact: Artifact) => void;
  onRetry?: (assistantMessageId: string) => void;
  onEdit?: (userMessageId: string, newContent: string) => void;

  // Context meter
  liveContextPercent?: number;
  onCompact: () => void;
  compacting: boolean;

  // Agent trace
  traceEntries: TraceEntry[];
}

// Shared ReactMarkdown config so markdown renders identically in streaming
// vs. finalized assistant messages.
const markdownComponents = (onCitationClick: (id: string) => void) => ({
  p: ({ children }: { children?: React.ReactNode }) => (
    <p>{injectCitations(children, onCitationClick)}</p>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li>{injectCitations(children, onCitationClick)}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1>{injectCitations(children, onCitationClick)}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2>{injectCitations(children, onCitationClick)}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3>{injectCitations(children, onCitationClick)}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4>{injectCitations(children, onCitationClick)}</h4>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
});

export default function ChatPane({
  sessionId,
  messages,
  streamingText,
  artifacts,
  documents,
  isStreaming,
  onSend,
  onStop,
  onCitationClick,
  onUploadClick,
  onArtifactPreview,
  onRetry,
  onEdit,
  liveContextPercent,
  onCompact,
  compacting,
  traceEntries,
}: Props) {
  const [input, setInput] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    }
    if (plusOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [plusOpen]);

  function submit() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    onSend(text, documents.map((d) => d.filename));
  }

  const q = searchQuery.trim().toLowerCase();
  const visibleMessages = q
    ? messages.filter((m) => m.content.toLowerCase().includes(q))
    : messages;

  return (
    <div className="flex flex-col h-full relative">
      {/* In-session search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2d3148] bg-[#0f1117]">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in this conversation…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
          />
          {q && (
            <span className="text-xs text-slate-500">
              {visibleMessages.length} / {messages.length}
            </span>
          )}
          <button
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
            className="p-1 text-slate-500 hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-slate-600 text-sm pt-16">
            Upload a document, then ask a question.
          </div>
        )}

        {visibleMessages.map((msg, idx) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            isLastAssistant={
              msg.role === "assistant" && idx === visibleMessages.length - 1
            }
            onCitationClick={onCitationClick}
            onRetry={onRetry}
            onEdit={onEdit}
          />
        ))}

        {/* Streaming response — thinking indicator while agents work, then text streams in */}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0 text-sm leading-relaxed text-slate-200">
              {streamingText ? (
                <>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents(onCitationClick)}
                    >
                      {streamingText}
                    </ReactMarkdown>
                  </div>
                  <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
                </>
              ) : (
                <div className="flex items-center gap-2 py-1 text-slate-500">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  <span className="text-xs text-slate-500">Agents working…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Artifacts inline */}
        {artifacts.length > 0 && (
          <div className="space-y-2 pl-10 max-w-[50%]">
            <p className="text-xs text-slate-500 font-medium">Generated artifacts</p>
            {artifacts.map((a) => (
              <ArtifactCard
                key={a.id}
                artifact={a}
                onPreview={onArtifactPreview}
              />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Inline Agent Trace panel */}
      <AgentTracePanel entries={traceEntries} streaming={isStreaming} />

      {/* Input bar */}
      <div className="px-4 pt-3 pb-4 border-t border-[#2d3148] bg-[#0f1117]">
        <div className="bg-[#1a1d27] rounded-xl border border-[#2d3148] px-3 py-2 focus-within:border-blue-500/40 transition">
          <div className="flex items-end gap-2">
            {/* + button with popover */}
            <div className="relative" ref={plusRef}>
              <button
                onClick={() => setPlusOpen((v) => !v)}
                className="p-2 text-slate-400 hover:text-slate-100 hover:bg-[#2d3148] rounded-lg transition"
                title="Add"
              >
                <Plus className="w-4 h-4" />
              </button>
              {plusOpen && (
                <div className="absolute bottom-full mb-2 left-0 bg-[#13151f] border border-[#2d3148] rounded-lg shadow-xl py-1 min-w-[160px] z-10">
                  <button
                    onClick={() => { setPlusOpen(false); onUploadClick(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-[#1a1d27] transition text-left"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload files
                  </button>
                </div>
              )}
            </div>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
              placeholder="Ask a question about the document…"
              rows={1}
              disabled={isStreaming}
              className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 resize-none outline-none leading-relaxed max-h-32 overflow-y-auto disabled:opacity-50 py-2"
            />

            <button
              onClick={() => setSearchOpen((v) => !v)}
              className={`p-2 rounded-lg transition ${
                searchOpen
                  ? "text-blue-400 bg-blue-600/10"
                  : "text-slate-400 hover:text-slate-100 hover:bg-[#2d3148]"
              }`}
              title="Search in conversation"
            >
              <Search className="w-4 h-4" />
            </button>

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

          {/* Context meter in bar */}
          <div className="flex items-center justify-end pt-2 border-t border-[#2d3148]/50 mt-2">
            <ContextMeter
              sessionId={sessionId}
              livePercent={liveContextPercent}
              onCompact={onCompact}
              compacting={compacting}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

function MessageRow({
  msg,
  isLastAssistant,
  onCitationClick,
  onRetry,
  onEdit,
}: {
  msg: ChatMessage;
  isLastAssistant: boolean;
  onCitationClick: (id: string) => void;
  onRetry?: (id: string) => void;
  onEdit?: (id: string, newContent: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore.
    }
  }

  function startEditing() {
    // Lock the editing container to the rendered bubble width so the textarea
    // doesn't collapse around the cursor when the user clears content.
    if (bubbleRef.current) setEditWidth(bubbleRef.current.offsetWidth);
    setDraft(msg.content);
    setEditing(true);
  }

  function saveEdit() {
    const next = draft.trim();
    if (!next || next === msg.content) { setEditing(false); return; }
    setEditing(false);
    onEdit?.(msg.id, next);
  }

  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex gap-3 justify-end">
        <div className="flex flex-col items-end max-w-[85%] min-w-0">
          {editing ? (
            // Lock the editing container to the original bubble's measured width
            // so the textarea retains the message bubble's footprint.
            <div
              className="bg-[#1a1d27] rounded-2xl px-3 py-2 border border-blue-500/40"
              style={editWidth ? ({ width: `${editWidth}px` } as CSSProperties) : undefined}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(2, draft.split("\n").length)}
                className="w-full bg-transparent text-sm text-slate-100 outline-none resize-none"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setEditing(false); setDraft(msg.content); }}
                  className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Save &amp; resend
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {/* Bubble with optional doc chips inside */}
              <div ref={bubbleRef} className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed break-words">
                {msg.attachedDocs && msg.attachedDocs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {msg.attachedDocs.map((name) => (
                      <span
                        key={name}
                        className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/40 rounded-md text-xs text-blue-100"
                      >
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="max-w-[12rem] truncate">{name}</span>
                      </span>
                    ))}
                  </div>
                )}
                <span className="whitespace-pre-wrap">{msg.content}</span>
              </div>
              {/* Actions: bottom-left of bubble */}
              <div className="flex items-center gap-1 self-start pl-1">
                <IconBtn onClick={copy} title={copied ? "Copied" : "Copy"}>
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </IconBtn>
                {onEdit && (
                  <IconBtn onClick={startEditing} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </IconBtn>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
          <User className="w-4 h-4 text-slate-300" />
        </div>
      </div>
    );
  }

  // Assistant row: no bubble — markdown renders flush on the page. Action row
  // is always visible directly under the content (left-aligned).
  return (
    <div className="flex gap-3 justify-start">
      <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents(onCitationClick)}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
        <div className="flex items-center gap-1 mt-2">
          <IconBtn onClick={copy} title={copied ? "Copied" : "Copy"}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </IconBtn>
          {isLastAssistant && onRetry && (
            <IconBtn onClick={() => onRetry(msg.id)} title="Retry">
              <RotateCcw className="w-3.5 h-3.5" />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27] transition"
    >
      {children}
    </button>
  );
}
