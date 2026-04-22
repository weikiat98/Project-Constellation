"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { X, Upload as UploadIcon, Pencil, Check } from "lucide-react";
import { api, type Artifact, type Document, type Session, type Audience } from "@/lib/api";
import { subscribeToStream, type SSEEvent } from "@/lib/sse";
import ChatPane, { type ChatMessage } from "@/components/ChatPane";
import type { TraceEntry } from "@/components/AgentTrace";
import UploadZone from "@/components/UploadZone";
import AudienceToggle from "@/components/AudienceToggle";
import SourceDrawer from "@/components/SourceDrawer";
import ChatSidebar from "@/components/ChatSidebar";
import ArtifactPreview from "@/components/ArtifactPreview";
import SessionFiles from "@/components/SessionFiles";

let _uid = 0;
function uid() { return String(++_uid); }

// Detect explicit audience signals in a prompt. Returns the inferred audience
// or null if the prompt contains no explicit instruction.
// Only fires on clear, unambiguous phrasings so casual language doesn't
// accidentally override the user's toggle choice.
function inferAudience(text: string): import("@/lib/api").Audience | null {
  const t = text.toLowerCase();

  const laypersonPatterns = [
    /\blayman'?s?\s+terms?\b/,
    /\blayperson\b/,
    /\bsimple\s+(terms?|language|english|words?|explanation|way)\b/,
    /\bexplain\s+(it\s+)?simply\b/,
    /\bplain\s+(english|language|terms?|words?)\b/,
    /\beas(y|ily)\s+to\s+understand\b/,
    /\bnon[- ]?technical\b/,
    /\bno\s+jargon\b/,
    /\blike\s+i'?m?\s+(a\s+)?(5|five|kid|child|beginner|novice|dummy)\b/,
    /\beli5\b/,
    /\bsimplif(y|ied)\b/,
  ];

  const expertPatterns = [
    /\bexpert\s+(level|terms?|language|analysis|view)\b/,
    /\btechnical\s+(terms?|language|detail|analysis|explanation)\b/,
    /\bin\s+depth\s+technical\b/,
    /\bprecise\s+(legal|technical)\b/,
    /\bfull\s+(legal|technical)\s+(detail|analysis)\b/,
    /\bassume\s+(i\s+am|i'?m|we\s+are|we'?re)\s+(an?\s+)?(expert|professional|lawyer|specialist|engineer)\b/,
  ];

  const professionalPatterns = [
    /\bprofessional\s+(terms?|language|tone|explanation|summary)\b/,
    /\bfor\s+a\s+professional\b/,
    /\bbusiness\s+(language|terms?|context)\b/,
    /\bdomain\s+terminology\b/,
  ];

  if (laypersonPatterns.some((p) => p.test(t))) return "layperson";
  if (expertPatterns.some((p) => p.test(t))) return "expert";
  if (professionalPatterns.some((p) => p.test(t))) return "professional";
  return null;
}

function persistedToTrace(e: {
  run_index: number;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}): TraceEntry {
  const ts = Date.parse(e.created_at) || Date.now();
  const p = e.payload || {};
  return {
    id: `p-${e.run_index}-${e.seq}`,
    type: e.event_type as TraceEntry["type"],
    timestamp: ts,
    agent_id: p.agent_id as string | undefined,
    role: p.role as string | undefined,
    tool: p.tool as string | undefined,
    input: p.input as Record<string, unknown> | undefined,
    artifact_id: p.artifact_id as string | undefined,
    artifact_name: p.name as string | undefined,
    summary: p.summary as string | undefined,
    before_tokens: p.before_tokens as number | undefined,
    after_tokens: p.after_tokens as number | undefined,
  };
}

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);

  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [audience, setAudience] = useState<Audience>("professional");
  const [liveContextPercent, setLiveContextPercent] = useState<number | undefined>();
  const [compacting, setCompacting] = useState(false);
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const stopRef = useRef<(() => void) | null>(null);
  const didAttachInitial = useRef(false);

  const attachStream = useCallback(() => {
    setStreamingText("");
    setThinkingText("");
    setIsStreaming(true);
    let accumulatedThinking = "";
    let accumulatedText = "";
    // Artifacts produced *during this run* — attached to the assistant
    // message that the run commits, so the inline artifact row only shows
    // the files generated for that specific user query (not every artifact
    // in the session).
    const runArtifactIds: string[] = [];
    // Defer the artifact preview auto-open until the recap has streamed
    // so the user reads the chat reply before the canvas pops open.
    let pendingPreviewArtifactId: string | null = null;

    const unsubscribe = subscribeToStream(
      sessionId,
      (event: SSEEvent) => {
        switch (event.type) {
          case "thinking_delta":
            accumulatedThinking += event.delta;
            setThinkingText(accumulatedThinking);
            break;
          case "thinking_clear":
            // Backend signals that what was streamed as thinking is actually
            // the user-facing message (model ended turn without `finalize`).
            // Drop the accumulated thinking so it isn't duplicated under the
            // final chat bubble.
            accumulatedThinking = "";
            setThinkingText("");
            break;
          case "text_delta":
            // Legacy path: if any agent still publishes plain text_delta,
            // treat it as streaming content (kept for forward compatibility).
            accumulatedText += event.delta;
            setStreamingText(accumulatedText);
            break;
          case "final_message":
            accumulatedText = event.content;
            setStreamingText(event.content);
            break;
          case "agent_spawned":
            setTraceEntries((p) => [...p, { id: uid(), type: "agent_spawned", timestamp: Date.now(), agent_id: event.agent_id, role: event.role }]);
            break;
          case "tool_use":
            setTraceEntries((p) => [...p, { id: uid(), type: "tool_use", timestamp: Date.now(), agent_id: event.agent_id, tool: event.tool, input: event.input }]);
            break;
          case "artifact_written":
            runArtifactIds.push(event.artifact_id);
            pendingPreviewArtifactId = event.artifact_id;
            setTraceEntries((p) => [...p, { id: uid(), type: "artifact_written", timestamp: Date.now(), artifact_id: event.artifact_id, artifact_name: event.name }]);
            // Refresh the artifact list so the header / sidebar counts stay
            // in sync, but defer auto-opening the preview until the recap
            // has streamed (handled in run_complete).
            api.getSession(sessionId).then((d) => setArtifacts(d.artifacts)).catch(() => {});
            break;
          case "agent_done":
            setTraceEntries((p) => [...p, { id: uid(), type: "agent_done", timestamp: Date.now(), agent_id: event.agent_id, summary: event.summary }]);
            break;
          case "context_usage":
            setLiveContextPercent(event.percent);
            break;
          case "compaction_done":
            setTraceEntries((p) => [...p, { id: uid(), type: "compaction_done", timestamp: Date.now(), before_tokens: event.before_tokens, after_tokens: event.after_tokens }]);
            break;
          case "run_complete":
            // The backend persisted the assistant message (with its artifact
            // IDs and thinking trace). Refetch authoritative state instead of
            // relying on in-stream accumulators — this also repairs races
            // where `final_message` was empty or arrived out of order.
            api.getSession(sessionId).then((d) => {
              setSession(d.session);
              setArtifacts(d.artifacts);
              setMessages(
                d.messages.map((m) => ({
                  id: m.id,
                  role: m.role as "user" | "assistant",
                  content: m.content,
                  artifactIds:
                    m.artifact_ids && m.artifact_ids.length ? m.artifact_ids : undefined,
                  thinking: m.thinking || undefined,
                }))
              );
              // Now that the recap has been delivered, open the most recent
              // artifact in the canvas so the user can review it.
              if (pendingPreviewArtifactId) {
                const newest = d.artifacts.find((a) => a.id === pendingPreviewArtifactId);
                if (newest) setPreviewArtifact(newest);
                pendingPreviewArtifactId = null;
              }
            }).catch(() => {});
            accumulatedText = "";
            accumulatedThinking = "";
            runArtifactIds.length = 0;
            setStreamingText("");
            setThinkingText("");
            setIsStreaming(false);
            break;
          case "error":
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: `Error: ${event.message}` }]);
            accumulatedText = "";
            accumulatedThinking = "";
            setStreamingText("");
            setThinkingText("");
            setIsStreaming(false);
            break;
        }
      },
      () => {
        // Stream closed — source-of-truth is the backend. Refetch so any
        // message the backend persisted (even one the SSE never delivered a
        // `final_message` for) shows up immediately.
        api.getSession(sessionId).then((d) => {
          setSession(d.session);
          setArtifacts(d.artifacts);
          setMessages(
            d.messages.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              artifactIds:
                m.artifact_ids && m.artifact_ids.length ? m.artifact_ids : undefined,
              thinking: m.thinking || undefined,
            }))
          );
        }).catch(() => {});
        setStreamingText("");
        setThinkingText("");
        setIsStreaming(false);
      }
    );

    stopRef.current = unsubscribe;
  }, [sessionId]);

  // Load session on mount.
  useEffect(() => {
    api.getSession(sessionId).then((detail) => {
      setSession(detail.session);
      if (detail.session.audience) setAudience(detail.session.audience);
      setMessages(
        detail.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          artifactIds: m.artifact_ids && m.artifact_ids.length ? m.artifact_ids : undefined,
          thinking: m.thinking || undefined,
        }))
      );
      setDocuments(detail.documents);
      setArtifacts(detail.artifacts);
      // Load persisted trace so history survives reloads & chat switching.
      api.getTrace(sessionId)
        .then((t) => setTraceEntries(t.events.map(persistedToTrace)))
        .catch(() => {});
      // Seed the context meter from persisted tokens so it's never stuck at 0.
      api.getContext(sessionId).then((u) => setLiveContextPercent(u.percent)).catch(() => {});

      // Handoff from /home: URL carries ?prompt=<text>&audience=<a>.
      const promptParam = searchParams?.get("prompt");
      const audParam = searchParams?.get("audience") as Audience | null;
      if (!didAttachInitial.current && promptParam) {
        didAttachInitial.current = true;
        // Explicit URL param takes priority; otherwise infer from the prompt
        // text; otherwise fall back to the session's persisted audience.
        const inferred = !audParam ? inferAudience(promptParam) : null;
        const chosenAud = audParam || inferred || audience;
        if (audParam) setAudience(audParam);
        else if (inferred && inferred !== audience) {
          setAudience(inferred);
          api.updateSession(sessionId, { audience: inferred }).catch(() => {});
        }
        router.replace(`/sessions/${sessionId}`);
        setMessages((prev) => [...prev, { id: uid(), role: "user", content: promptParam, attachedDocs: detail.documents.map((d) => d.filename) }]);
        attachStream();
        api.sendMessage(sessionId, promptParam, chosenAud)
          .then(() =>
            api.getSession(sessionId).then((d) => {
              setSession(d.session);
              window.dispatchEvent(new CustomEvent("sessions-changed"));
            }).catch(() => {})
          )
          .catch(() => {
            setIsStreaming(false);
            stopRef.current?.();
          });
      }
    }).catch(() => router.push("/home"));
  }, [sessionId, router, searchParams, attachStream, audience]);

  const handleSend = useCallback(async (text: string, attachedDocs: string[] = []) => {
    if (isStreaming) return;

    // Auto-adjust audience if the prompt explicitly requests a different level.
    const inferred = inferAudience(text);
    const resolvedAudience = inferred ?? audience;
    if (inferred && inferred !== audience) {
      setAudience(inferred);
      api.updateSession(sessionId, { audience: inferred }).catch(() => {});
    }

    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text, attachedDocs }]);
    attachStream();
    try {
      await api.sendMessage(sessionId, text, resolvedAudience);
      // Refresh session so the auto-generated title shows up in both the
      // header and the sidebar without requiring a page reload.
      api.getSession(sessionId).then((d) => {
        setSession(d.session);
        window.dispatchEvent(new CustomEvent("sessions-changed"));
      }).catch(() => {});
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [sessionId, audience, isStreaming, attachStream]);

  function handleStop() {
    stopRef.current?.();
    stopRef.current = null;
    setIsStreaming(false);
    if (streamingText) {
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: streamingText + " [stopped]" }]);
      setStreamingText("");
    }
    setThinkingText("");
  }

  async function handleCompact() {
    setCompacting(true);
    await api.compact(sessionId).catch(() => {});
    setCompacting(false);
  }

  async function commitTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === (session?.title || "")) return;
    setSession((prev) => (prev ? { ...prev, title: next } : prev));
    try {
      await api.updateSession(sessionId, { title: next });
    } catch {
      // ignore; UI rolls back via next refresh
    }
  }

  const handleRetry = useCallback(async (assistantMessageId: string) => {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx < 1) return;
    const userMsg = messages[idx - 1];
    if (userMsg.role !== "user") return;

    try {
      await api.truncateAfter(sessionId, assistantMessageId);
    } catch {}
    setMessages((prev) => prev.filter((_, i) => i < idx));
    attachStream();
    try {
      await api.sendMessage(sessionId, userMsg.content, audience);
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream]);

  const handleEdit = useCallback(async (userMessageId: string, newContent: string) => {
    if (isStreaming) return;
    try {
      await api.truncateAfter(sessionId, userMessageId);
    } catch {}
    const idx = messages.findIndex((m) => m.id === userMessageId);
    setMessages((prev) => {
      const kept = idx >= 0 ? prev.slice(0, idx) : prev;
      return [...kept, { id: uid(), role: "user", content: newContent, attachedDocs: prev[idx]?.attachedDocs }];
    });
    attachStream();
    try {
      await api.sendMessage(sessionId, newContent, audience);
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream]);

  const previewOpen = !!previewArtifact;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0b10]">
      <ChatSidebar activeSessionId={sessionId} />

      {/* Main column — shrinks when the artifact preview is open. */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header: AudienceToggle centred, title editable */}
        <header className="h-14 shrink-0 flex items-center px-4 border-b border-[#2d3148] bg-[#0f1117] relative">
          <div className="flex items-center gap-2 min-w-0 max-w-xs">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                  else if (e.key === "Escape") { setEditingTitle(false); }
                }}
                className="flex-1 min-w-0 bg-[#0f1117] border border-[#2d3148] rounded px-2 py-0.5 text-sm text-slate-100 outline-none focus:border-blue-500/50"
              />
            ) : (
              <>
                <span className="text-sm text-slate-400 truncate" title={session?.title || "Constellation Session"}>
                  {session?.title || "Constellation Session"}
                </span>
                <button
                  onClick={() => { setTitleDraft(session?.title || ""); setEditingTitle(true); }}
                  title="Rename chat"
                  className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27] transition shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {editingTitle && (
              <button
                onMouseDown={(e) => { e.preventDefault(); commitTitle(); }}
                title="Save"
                className="p-1 rounded text-emerald-400 hover:bg-[#1a1d27] transition"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2">
            <AudienceToggle
              value={audience}
              onChange={(next) => {
                setAudience(next);
                // Persist the user's choice so refresh / session switching keeps it.
                api.updateSession(sessionId, { audience: next }).catch(() => {});
              }}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SessionFiles
              documents={documents}
              artifacts={artifacts}
              onUploadClick={() => setUploadOpen(true)}
              onArtifactClick={setPreviewArtifact}
            />
          </div>
        </header>

        {/* Main chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatPane
            sessionId={sessionId}
            messages={messages}
            streamingText={streamingText}
            thinkingText={thinkingText}
            artifacts={artifacts}
            documents={documents}
            isStreaming={isStreaming}
            onSend={handleSend}
            onStop={handleStop}
            onCitationClick={(id) => setDrawerChunkId(id)}
            onUploadClick={() => setUploadOpen(true)}
            onArtifactPreview={setPreviewArtifact}
            onRetry={handleRetry}
            onEdit={handleEdit}
            onDropFile={async (file) => {
              try {
                const doc = await api.uploadDocument(sessionId, file);
                setDocuments((prev) => [...prev, doc]);
              } catch {
                // Upload failures surface via the next session refresh.
              }
            }}
            liveContextPercent={liveContextPercent}
            onCompact={handleCompact}
            compacting={compacting}
            traceEntries={traceEntries}
          />
        </main>
      </div>

      {/* Artifact preview — lives in the flex row so it shrinks the chat column
          instead of overlapping it. */}
      {previewOpen && (
        <ArtifactPreview
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
          onCitationClick={(id) => setDrawerChunkId(id)}
        />
      )}

      {/* Source drawer for citations (still overlay) */}
      <SourceDrawer chunkId={drawerChunkId} onClose={() => setDrawerChunkId(null)} />

      {/* Upload modal */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60"
          onClick={() => setUploadOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#13151f] border border-[#2d3148] rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <UploadIcon className="w-4 h-4 text-blue-400" />
                Upload files
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <UploadZone
                sessionId={sessionId}
                onUploaded={(doc) => {
                  setDocuments((prev) => [...prev, doc]);
                  setTimeout(() => setUploadOpen(false), 800);
                }}
              />
              {documents.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                    In this chat
                  </p>
                  <ul className="space-y-1">
                    {documents.map((d) => (
                      <li key={d.id} className="flex items-start gap-1.5 text-xs text-slate-400 truncate">
                        <span className="text-slate-600 shrink-0">•</span>
                        <span className="truncate" title={d.filename}>{d.filename}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
