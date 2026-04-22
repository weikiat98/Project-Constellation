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
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from "lucide-react";
import { api, type Artifact, type Document, type TokenCount } from "@/lib/api";
import CitationLink from "./CitationLink";
import ArtifactCard from "./ArtifactCard";
import ContextMeter from "./ContextMeter";
import TokenCounter from "./TokenCounter";
import AgentTracePanel from "./AgentTracePanel";
import type { TraceEntry } from "./AgentTrace";

// Match a citation block: one or more UUIDs separated by `,` `;` or whitespace
// inside square brackets. e.g. [uuid], [uuid, uuid], [uuid; uuid].
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CITATION_RE = new RegExp(`\\[(${UUID}(?:\\s*[,;]\\s*${UUID})*)\\]`, "g");
const UUID_RE = new RegExp(UUID, "g");

// Context passed through markdown rendering so a text node knows how to decorate
// itself: citations (always) + search highlights (when a query is active).
interface RenderContext {
  onCitation: (id: string) => void;
  messageId: string;
  // Cumulative count of matches in all *previous* messages, so this message can
  // assign globally-unique indices to its matches.
  baseMatchIndex: number;
  query: string; // already lower-cased; empty string means no search
  currentMatchIndex: number; // -1 if none
}

function highlightString(
  text: string,
  query: string,
  baseIndex: number,
  keyPrefix: string,
  currentMatchIndex: number,
  localOffset: { n: number }
): React.ReactNode[] {
  // Split `text` on case-insensitive occurrences of `query`, wrapping each
  // match in a <mark> with a data attribute so we can scroll-to-current.
  if (!query) return [text];
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let last = 0;
  let from = 0;
  while (from <= lower.length - query.length) {
    const hit = lower.indexOf(query, from);
    if (hit === -1) break;
    if (hit > last) parts.push(text.slice(last, hit));
    const globalIdx = baseIndex + localOffset.n;
    const isCurrent = globalIdx === currentMatchIndex;
    parts.push(
      <mark
        key={`${keyPrefix}-m${hit}`}
        data-match-index={globalIdx}
        className={
          isCurrent
            ? "bg-amber-400 text-slate-900 rounded-sm px-0.5"
            : "bg-amber-400/40 text-inherit rounded-sm px-0.5"
        }
      >
        {text.slice(hit, hit + query.length)}
      </mark>
    );
    localOffset.n += 1;
    last = hit + query.length;
    from = last;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function decorateText(text: string, keyPrefix: string, ctx: RenderContext): React.ReactNode[] {
  // Two-pass: first split on citation brackets, then for non-citation
  // sub-strings, split on the search query and wrap hits in <mark>.
  const out: React.ReactNode[] = [];
  const localOffset = { n: 0 };
  let last = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > last) {
      out.push(
        ...highlightString(
          text.slice(last, match.index),
          ctx.query,
          ctx.baseMatchIndex,
          `${keyPrefix}-${last}`,
          ctx.currentMatchIndex,
          localOffset
        )
      );
    }
    const ids = match[1].match(UUID_RE) ?? [];
    ids.forEach((id, i) => {
      out.push(
        <CitationLink key={`${keyPrefix}-c${match!.index}-${i}`} chunkId={id} onClick={ctx.onCitation} />
      );
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    out.push(
      ...highlightString(
        text.slice(last),
        ctx.query,
        ctx.baseMatchIndex,
        `${keyPrefix}-${last}`,
        ctx.currentMatchIndex,
        localOffset
      )
    );
  }
  return out;
}

function injectCitations(nodes: React.ReactNode, ctx: RenderContext): React.ReactNode {
  if (typeof nodes === "string") return decorateText(nodes, "s", ctx);
  if (Array.isArray(nodes)) {
    return nodes.flatMap((n, i) =>
      typeof n === "string" ? decorateText(n, `a${i}`, ctx) : [n]
    );
  }
  return nodes;
}

function renderHighlightedPlain(
  text: string,
  query: string,
  baseIndex: number,
  currentMatchIndex: number,
  keyPrefix: string
): React.ReactNode {
  // For non-markdown bubbles (user messages). Returns a single array of nodes
  // with <mark> wrappers around query occurrences, numbered globally so the
  // current-match styling and scroll-into-view work the same as in assistant
  // markdown.
  const localOffset = { n: 0 };
  return highlightString(text, query, baseIndex, keyPrefix, currentMatchIndex, localOffset);
}

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  const lower = haystack.toLowerCase();
  while (from <= lower.length - needle.length) {
    const hit = lower.indexOf(needle, from);
    if (hit === -1) break;
    count += 1;
    from = hit + needle.length;
  }
  return count;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  attachedDocs?: string[]; // user-facing filenames attached when this message was sent
  thinking?: string; // reasoning text the agentic system produced while working on this turn
  artifactIds?: string[]; // artifacts produced *during this turn* — rendered inline with this message only
}

interface Props {
  sessionId: string;
  messages: ChatMessage[];
  streamingText: string;
  thinkingText: string;
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
  onDropFile?: (file: File) => void;

  // Context meter
  liveContextPercent?: number;
  onCompact: () => void;
  compacting: boolean;

  // Agent trace
  traceEntries: TraceEntry[];
}

// Shared ReactMarkdown config so markdown renders identically in streaming
// vs. finalized assistant messages.
const markdownComponents = (ctx: RenderContext) => ({
  p: ({ children }: { children?: React.ReactNode }) => (
    <p>{injectCitations(children, ctx)}</p>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li>{injectCitations(children, ctx)}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1>{injectCitations(children, ctx)}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2>{injectCitations(children, ctx)}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3>{injectCitations(children, ctx)}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4>{injectCitations(children, ctx)}</h4>
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
  thinkingText,
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
  onDropFile,
  liveContextPercent,
  onCompact,
  compacting,
  traceEntries,
}: Props) {
  const [input, setInput] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [tokenCount, setTokenCount] = useState<TokenCount | null>(null);
  const [countingTokens, setCountingTokens] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Debounced token-count fetch: recomputes ~400ms after the user stops typing,
  // also refreshes when the document set changes (new upload → larger base).
  // Skipped during streaming to avoid spamming the endpoint mid-run.
  useEffect(() => {
    if (isStreaming) return;
    const handle = window.setTimeout(() => {
      setCountingTokens(true);
      api.countTokens(sessionId, input)
        .then((tc) => setTokenCount(tc))
        .catch(() => {})
        .finally(() => setCountingTokens(false));
    }, 400);
    return () => window.clearTimeout(handle);
  }, [input, sessionId, documents.length, isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const q = searchQuery.trim().toLowerCase();

  // Per-message cumulative base indices + running total, so each message knows
  // the global index to assign to its first match.
  const { perMessageBaseIndex, totalMatches } = (() => {
    const bases: number[] = [];
    let running = 0;
    for (const m of messages) {
      bases.push(running);
      running += q ? countMatches(m.content, q) : 0;
    }
    return { perMessageBaseIndex: bases, totalMatches: running };
  })();

  // Reset the current match cursor when the query changes or matches shift.
  useEffect(() => {
    if (totalMatches === 0) {
      setCurrentMatchIndex(0);
    } else if (currentMatchIndex >= totalMatches) {
      setCurrentMatchIndex(0);
    }
    // Intentionally depend only on query & total — stepping shouldn't re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, totalMatches]);

  // Scroll the currently-focused match into view.
  useEffect(() => {
    if (!q || totalMatches === 0) return;
    const el = messagesRef.current?.querySelector(
      `mark[data-match-index="${currentMatchIndex}"]`
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentMatchIndex, q, totalMatches, messages]);

  function stepMatch(delta: number) {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev + delta + totalMatches) % totalMatches);
  }

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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Search in this conversation…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none"
          />
          {q && (
            <span className="text-xs text-slate-500 tabular-nums">
              {totalMatches === 0 ? "0/0" : `${currentMatchIndex + 1} / ${totalMatches}`}
            </span>
          )}
          <button
            onClick={() => stepMatch(-1)}
            disabled={totalMatches === 0}
            title="Previous match (Shift+Enter)"
            className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => stepMatch(1)}
            disabled={totalMatches === 0}
            title="Next match (Enter)"
            className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
            className="p-1 text-slate-500 hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-slate-600 text-sm pt-16">
            Upload a document, then ask a question.
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            isLastAssistant={
              msg.role === "assistant" && idx === messages.length - 1
            }
            artifacts={artifacts}
            onCitationClick={onCitationClick}
            onRetry={onRetry}
            onEdit={onEdit}
            onArtifactPreview={onArtifactPreview}
            searchQuery={q}
            baseMatchIndex={perMessageBaseIndex[idx] ?? 0}
            currentMatchIndex={currentMatchIndex}
          />
        ))}

        {/* Streaming response — thinking panel streams first, then the final
            message renders below it once `finalize` fires. */}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              {/* Live thinking panel (collapsible) — visible while agents work. */}
              {(thinkingText || !streamingText) && (
                <ThinkingPanel
                  text={thinkingText}
                  live
                  defaultOpen
                />
              )}

              {streamingText ? (
                <div className="text-sm leading-relaxed text-slate-200">
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents({
                        onCitation: onCitationClick,
                        messageId: "streaming",
                        baseMatchIndex: 0,
                        query: "",
                        currentMatchIndex: -1,
                      })}
                    >
                      {streamingText}
                    </ReactMarkdown>
                  </div>
                  <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              ) : !thinkingText ? (
                <div className="flex items-center gap-2 py-1 text-slate-500">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  <span className="text-xs text-slate-500">Agents working…</span>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Inline Agent Trace panel */}
      <AgentTracePanel entries={traceEntries} streaming={isStreaming} />

      {/* Input bar */}
      <div
        className="px-4 pt-3 pb-4 border-t border-[#2d3148] bg-[#0f1117]"
        onDragOver={(e) => {
          if (!onDropFile) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!onDropFile) return;
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onDropFile(file);
        }}
      >
        <div className={`bg-[#1a1d27] rounded-xl border px-3 py-2 focus-within:border-blue-500/40 transition ${
          dragOver ? "border-blue-500 bg-blue-500/10" : "border-[#2d3148]"
        }`}>
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
                className="p-2 bg-white hover:bg-slate-200 text-slate-900 rounded-lg transition shrink-0 disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Token counter + context meter in bar — counter sits directly to
              the left of the context percentage bar, both right-aligned. */}
          <div className="flex items-center justify-end pt-2 border-t border-[#2d3148]/50 mt-2 gap-3">
            <TokenCounter
              count={tokenCount}
              loading={countingTokens}
              hasDraft={input.trim().length > 0}
            />
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
  artifacts,
  onCitationClick,
  onRetry,
  onEdit,
  onArtifactPreview,
  searchQuery,
  baseMatchIndex,
  currentMatchIndex,
}: {
  msg: ChatMessage;
  isLastAssistant: boolean;
  artifacts: Artifact[];
  onCitationClick: (id: string) => void;
  onRetry?: (id: string) => void;
  onEdit?: (id: string, newContent: string) => void;
  onArtifactPreview?: (artifact: Artifact) => void;
  searchQuery: string;
  baseMatchIndex: number;
  currentMatchIndex: number;
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
                <span className="whitespace-pre-wrap">
                  {searchQuery
                    ? renderHighlightedPlain(
                        msg.content,
                        searchQuery,
                        baseMatchIndex,
                        currentMatchIndex,
                        `u-${msg.id}`
                      )
                    : msg.content}
                </span>
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

  // Assistant row: thinking panel (if any) above the final message, then the
  // message, then any artifacts this specific turn produced.
  const producedArtifacts = msg.artifactIds
    ? (msg.artifactIds
        .map((aid) => artifacts.find((a) => a.id === aid))
        .filter(Boolean) as Artifact[])
    : [];

  return (
    <div className="flex gap-3 justify-start">
      <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        {msg.thinking && (
          <div className="mb-3">
            <ThinkingPanel text={msg.thinking} live={false} />
          </div>
        )}
        {msg.content.trim() ? (
          <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents({
                onCitation: onCitationClick,
                messageId: msg.id,
                baseMatchIndex,
                query: searchQuery,
                currentMatchIndex,
              })}
            >
              {msg.content}
            </ReactMarkdown>
          </div>
        ) : (
          // Legacy empty-message guard: older sessions may have persisted an
          // empty assistant bubble when the Lead skipped `finalize`. Backend
          // now backfills a fallback, so this only triggers for stale rows.
          <div className="text-xs text-amber-400/80 italic bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-2">
            The assistant didn&apos;t return a visible reply for this turn.
            {producedArtifacts.length > 0 && " The generated files below are the output — click Retry to regenerate a recap."}
            {producedArtifacts.length === 0 && " Click Retry to run this prompt again."}
          </div>
        )}
        {producedArtifacts.length > 0 && (
          <div className="mt-3 space-y-2 max-w-[90%]">
            <p className="text-xs text-slate-500 font-medium">Generated files</p>
            {producedArtifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} onPreview={onArtifactPreview} />
            ))}
          </div>
        )}
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

/**
 * Collapsible panel that shows the lead/subagent reasoning stream. While live
 * (during streaming), it defaults open and shows a pulse indicator. Once the
 * turn is committed, it collapses by default — reopen via the header button.
 */
function ThinkingPanel({
  text,
  live,
  defaultOpen = false,
}: {
  text: string;
  live: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || live);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  useEffect(() => {
    if (open && live && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, open, live]);

  return (
    <div className="border border-[#2d3148] rounded-lg bg-[#0f1117]/60 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-[#13151f] transition"
      >
        <Brain className="w-3.5 h-3.5 text-purple-400" />
        <span className="font-medium">{live ? "Thinking…" : "Thought process"}</span>
        {live && (
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            live
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-slate-500">
          {open ? "Hide" : "Show"}
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>
      {open && (
        <div
          ref={scrollRef}
          className="max-h-64 overflow-y-auto px-3 py-2 text-xs text-slate-400 whitespace-pre-wrap leading-relaxed border-t border-[#2d3148] scroll-smooth font-mono"
        >
          {text || (live ? "Agents are starting up…" : "(no reasoning recorded)")}
          {live && <span className="inline-block w-1 h-3 bg-purple-400/70 animate-pulse ml-0.5 align-text-bottom" />}
        </div>
      )}
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

