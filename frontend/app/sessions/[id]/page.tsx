"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { X, Upload as UploadIcon, Pencil, Check } from "lucide-react";
import { api, type Artifact, type Document, type Session, type Audience } from "@/lib/api";
import { subscribeToStream, type SSEEvent } from "@/lib/sse";
import ChatPane, { type ChatMessage } from "@/components/ChatPane";
import { clearCitationCache } from "@/components/CitationLink";
import type { TraceEntry } from "@/components/AgentTrace";
import UploadZone from "@/components/UploadZone";
import AudienceToggle from "@/components/AudienceToggle";
import SourceDrawer from "@/components/SourceDrawer";
import ChatSidebar from "@/components/ChatSidebar";
import ArtifactPreview from "@/components/ArtifactPreview";
import SessionFiles from "@/components/SessionFiles";

let _uid = 0;
function uid() { return String(++_uid); }

// Convert a raw server message to ChatMessage shape.
function mapServerMessage(m: {
  id: string;
  role: string;
  content: string;
  artifact_ids?: string[];
  thinking?: string;
  attached_documents?: string[];
}): ChatMessage {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    artifactIds: m.artifact_ids && m.artifact_ids.length ? m.artifact_ids : undefined,
    thinking: m.thinking || undefined,
    attachedDocs: m.attached_documents && m.attached_documents.length ? m.attached_documents : undefined,
  };
}

// Merge server messages with transient system banners from current local state.
// Each banner is anchored to the count of non-system messages that preceded
// it locally, so it survives both reloads and message-truncation operations
// (retry/edit) — even when the next persisted message that originally followed
// the banner has been deleted from the server. The original ID-based anchor
// dropped any banner whose next-message ID was no longer in `serverMsgs`.
function mergeWithBanners(prev: ChatMessage[], serverMsgs: ChatMessage[]): ChatMessage[] {
  // Collect banners + the count of non-system messages preceding each one.
  const banners: Array<{ banner: ChatMessage; precedingCount: number }> = [];
  let count = 0;
  for (const m of prev) {
    if (m.role === "system") {
      banners.push({ banner: m, precedingCount: count });
    } else {
      count += 1;
    }
  }
  if (banners.length === 0) return serverMsgs;

  // Cap each anchor at the new server-message count so banners that pointed
  // past the (now-truncated) tail collapse to the end instead of disappearing.
  const result: ChatMessage[] = [];
  let inserted = 0;
  for (let i = 0; i < serverMsgs.length; i++) {
    while (
      inserted < banners.length &&
      Math.min(banners[inserted].precedingCount, serverMsgs.length) === i
    ) {
      result.push(banners[inserted].banner);
      inserted += 1;
    }
    result.push(serverMsgs[i]);
  }
  while (inserted < banners.length) {
    result.push(banners[inserted].banner);
    inserted += 1;
  }
  return result;
}

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
  // Artifact IDs produced during the currently-streaming turn. Rendered as
  // "Generated files" rows inside the live assistant bubble so the user sees
  // the download button appear while the recap is still typing in.
  const [runArtifactIds, setRunArtifactIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>("professional");
  const [liveContextPercent, setLiveContextPercent] = useState<number | undefined>();
  const [compacting, setCompacting] = useState(false);
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const stopRef = useRef<(() => void) | null>(null);
  const uploadCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didAttachInitial = useRef(false);
  const pendingCommitRef = useRef<(() => void) | null>(null);
  // Audience ref keeps the mount effect's closure free of `audience` as a
  // dependency, so manual toggles don't re-fire the effect (and trigger
  // extra getSession round-trips). The mount handoff reads the latest
  // audience from this ref instead of the captured prop.
  const audienceRef = useRef<Audience>(audience);
  useEffect(() => {
    audienceRef.current = audience;
  }, [audience]);

  const attachStream = useCallback(() => {
    // Close any prior EventSource before opening a new one. attachStream is
    // called from mount, send, retry, edit, and the /home handoff — without
    // this guard, rapid successive calls leak parallel SSE connections to
    // the same session.
    stopRef.current?.();
    stopRef.current = null;

    setStreamingText("");
    setThinkingText("");
    setIsStreaming(true);
    let accumulatedThinking = "";
    let accumulatedText = "";
    // Artifacts produced *during this run*. Tracked in a per-invocation
    // local array; we always derive React state from this single source so
    // there's no shared mutable state across overlapping attachStream calls.
    const runArtifactIds: string[] = [];
    setRunArtifactIds([]);
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
            // Now that the recap text is set, open the canvas for any artifact
            // that arrived earlier this turn (artifact_written fires before finalize).
            if (pendingPreviewArtifactId) {
              const artifactId = pendingPreviewArtifactId;
              pendingPreviewArtifactId = null;
              // Delay the canvas open until after the typewriter has had time
              // to reveal the recap, so the text streams first and the preview
              // slides in behind it rather than stealing focus mid-animation.
              window.setTimeout(() => {
                api.getSession(sessionId).then((d) => {
                  setArtifacts(d.artifacts);
                  const newest = d.artifacts.find((a) => a.id === artifactId);
                  if (newest) setPreviewArtifact(newest);
                }).catch(() => {});
              }, 1200);
            }
            break;
          case "agent_spawned":
            setTraceEntries((p) => [...p, { id: uid(), type: "agent_spawned", timestamp: Date.now(), agent_id: event.agent_id, role: event.role }]);
            break;
          case "tool_use":
            setTraceEntries((p) => [...p, { id: uid(), type: "tool_use", timestamp: Date.now(), agent_id: event.agent_id, tool: event.tool, input: event.input }]);
            break;
          case "artifact_written":
            runArtifactIds.push(event.artifact_id);
            // Expose the in-flight artifact IDs to ChatPane so the "Generated
            // files" button can render inside the streaming bubble, not only
            // after run_complete commits the assistant message. Use a fresh
            // copy each time so React reliably re-renders.
            setRunArtifactIds(runArtifactIds.slice());
            // Buffer the artifact ID — canvas preview is deferred until
            // final_message fires so the recap text appears first.
            pendingPreviewArtifactId = event.artifact_id;
            setTraceEntries((p) => [...p, { id: uid(), type: "artifact_written", timestamp: Date.now(), artifact_id: event.artifact_id, artifact_name: event.name }]);
            // Refresh the artifact list so the header / sidebar counts stay
            // in sync, but defer auto-opening the preview until the recap
            // has streamed (handled in final_message).
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
            // With real server-side streaming, all text_delta events have
            // already arrived before run_complete fires, so we can commit
            // immediately — no typewriter deferral needed.
            api.getSession(sessionId).then((d) => {
              setSession(d.session);
              setArtifacts(d.artifacts);
              setMessages((prev) =>
                mergeWithBanners(prev, d.messages.map(mapServerMessage))
              );
              accumulatedText = "";
              accumulatedThinking = "";
              runArtifactIds.length = 0;
              setRunArtifactIds([]);
              setStreamingText("");
              setThinkingText("");
              setIsStreaming(false);
            }).catch(() => {
              accumulatedText = "";
              accumulatedThinking = "";
              runArtifactIds.length = 0;
              setRunArtifactIds([]);
              setIsStreaming(false);
            });
            break;
          case "error":
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: `Error: ${event.message}` }]);
            accumulatedText = "";
            accumulatedThinking = "";
            setStreamingText("");
            setThinkingText("");
            setRunArtifactIds([]);
            setIsStreaming(false);
            break;
        }
      },
      () => {
        // Stream closed without run_complete (e.g. network blip) — refetch.
        if (pendingCommitRef.current) return;
        api.getSession(sessionId).then((d) => {
          setSession(d.session);
          setArtifacts(d.artifacts);
          setMessages((prev) =>
            mergeWithBanners(prev, d.messages.map(mapServerMessage))
          );
        }).catch(() => {});
        setStreamingText("");
        setThinkingText("");
        setRunArtifactIds([]);
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
      setMessages((prev) =>
        mergeWithBanners(prev, detail.messages.map(mapServerMessage))
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
        const currentAudience = audienceRef.current;
        const inferred = !audParam ? inferAudience(promptParam) : null;
        const chosenAud = audParam || inferred || currentAudience;
        if (audParam) setAudience(audParam);
        else if (inferred && inferred !== currentAudience) {
          setAudience(inferred);
          api.updateSession(sessionId, { audience: inferred }).catch(() => {});
        }
        router.replace(`/sessions/${sessionId}`);
        const handoffAttachedIds = detail.documents.map((d) => d.id);
        setMessages((prev) => [...prev, { id: uid(), role: "user", content: promptParam, attachedDocs: detail.documents.map((d) => d.filename) }]);
        attachStream();
        api.sendMessage(sessionId, promptParam, chosenAud, handoffAttachedIds)
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
      } else if (
        !didAttachInitial.current &&
        detail.session.last_run_state === "running"
      ) {
        // No handoff prompt, but the backend says a run is still in flight on
        // this session — most likely the user navigated away from this session
        // mid-stream and just came back. Re-subscribe to the SSE bus so the
        // remaining events (including `final_message` / `run_complete`) drive
        // the UI to its terminal state. Persisted trace already filled in any
        // events that fired while we were unmounted.
        didAttachInitial.current = true;
        attachStream();
      }
    }).catch(() => router.push("/home"));

    // Cleanup: when the user navigates away (different session, /home, etc.),
    // close the EventSource so we don't leak connections. The backend run
    // itself keeps running — the next mount will detect last_run_state and
    // re-attach.
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
    // `audience` intentionally omitted — it's read via audienceRef so manual
    // toggles don't trigger an extra getSession refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, router, searchParams, attachStream]);

  const handleSend = useCallback(async (text: string, attachedDocs: string[] = []) => {
    if (isStreaming) return;

    // Auto-adjust audience if the prompt explicitly requests a different level.
    // The inferred audience is applied to *this turn only* — we no longer
    // persist it to the session. Sticky persistence made transient phrasings
    // (e.g. "assume I'm an engineer for this one question") flip the entire
    // session's audience, requiring a manual toggle back.
    const inferred = inferAudience(text);
    const resolvedAudience = inferred ?? audience;
    if (inferred && inferred !== audience) {
      setAudience(inferred);
    }

    setMessages((prev) => {
      // If the prompt triggered an inferred audience switch, drop a banner
      // *before* the user message so the user can see why the next reply is
      // in a different register.
      const banner: ChatMessage[] =
        inferred && inferred !== audience
          ? [
              {
                id: uid(),
                role: "system",
                systemKind: "audience_change",
                content: `switched to ${inferred} mode`,
              },
            ]
          : [];
      return [
        ...prev,
        ...banner,
        { id: uid(), role: "user", content: text, attachedDocs },
      ];
    });
    attachStream();
    try {
      // Persist the documents that were present at send time so the chip
      // re-renders correctly on reload. Source-of-truth for IDs is the
      // current `documents` state (kept in sync with the backend via
      // session refresh + upload handlers).
      await api.sendMessage(
        sessionId,
        text,
        resolvedAudience,
        documents.map((d) => d.id)
      );
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
  }, [sessionId, audience, isStreaming, attachStream, documents]);

  function handleStop() {
    // Tell the backend to stop the agentic loop at its next iteration so
    // we don't keep burning tokens after the user clicks Stop. The SSE
    // close below is local-only — it does not interrupt the backend run.
    api.cancelRun(sessionId).catch(() => {});
    stopRef.current?.();
    stopRef.current = null;
    setIsStreaming(false);
    if (streamingText) {
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: streamingText + " [stopped]" }]);
      setStreamingText("");
    }
    setThinkingText("");
    setRunArtifactIds([]);
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
      // Re-send with the same doc set the user had at retry time — keeps the
      // re-rendered user bubble's chips consistent with what the agent saw.
      await api.sendMessage(
        sessionId,
        userMsg.content,
        audience,
        documents.map((d) => d.id)
      );
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream, documents]);

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
      await api.sendMessage(
        sessionId,
        newContent,
        audience,
        documents.map((d) => d.id)
      );
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream, documents]);

  // No-op: commit now happens immediately on run_complete. Kept as a safety
  // shim in case a stale deferred flush was queued (e.g. race on reconnect).
  const handleTypewriterComplete = useCallback(() => {
    const pending = pendingCommitRef.current;
    if (pending) { pendingCommitRef.current = null; pending(); }
  }, []);

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
                if (next === audience) return;
                setAudience(next);
                // Drop a transient banner in the chat so the user has a clear
                // visual marker of when the toggle took effect.
                setMessages((prev) => [
                  ...prev,
                  {
                    id: uid(),
                    role: "system",
                    systemKind: "audience_change",
                    content: `switched to ${next} mode`,
                  },
                ]);
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
              onDocumentDelete={async (d) => {
                if (!window.confirm(`Remove "${d.filename}" from this chat?`)) return;
                try {
                  await api.deleteDocument(sessionId, d.id);
                  setDocuments((prev) => prev.filter((x) => x.id !== d.id));
                  // Citation labels in older messages cache the deleted
                  // document's filename — clear them so subsequent renders
                  // re-fetch (and surface as "not found") instead of
                  // showing a stale label.
                  clearCitationCache();
                } catch (err) {
                  // Surface the server's reason (most often: doc is referenced
                  // by a previous message) so the user knows why it failed.
                  const msg =
                    err instanceof Error ? err.message : "Failed to delete document.";
                  window.alert(msg);
                }
              }}
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
            streamingArtifactIds={runArtifactIds}
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
            onDropFile={async (files) => {
              for (const file of Array.from(files)) {
                try {
                  const doc = await api.uploadDocument(sessionId, file);
                  setDocuments((prev) => [...prev, doc]);
                } catch {
                  // Upload failures surface via the next session refresh.
                }
              }
            }}
            onTypewriterComplete={handleTypewriterComplete}
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
                  // Debounce close: reset the timer on each file so the modal
                  // stays open until all uploads in a multi-file batch finish.
                  if (uploadCloseTimerRef.current) clearTimeout(uploadCloseTimerRef.current);
                  uploadCloseTimerRef.current = setTimeout(() => setUploadOpen(false), 800);
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
