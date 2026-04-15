"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { api, type Artifact, type Document, type Session, type Audience } from "@/lib/api";
import { subscribeToStream, type SSEEvent, type TraceEntry as _TE } from "@/lib/sse";
import ChatPane from "@/components/ChatPane";
import AgentTrace, { type TraceEntry } from "@/components/AgentTrace";
import UploadZone from "@/components/UploadZone";
import AudienceToggle from "@/components/AudienceToggle";
import ContextMeter from "@/components/ContextMeter";
import SourceDrawer from "@/components/SourceDrawer";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let _uid = 0;
function uid() { return String(++_uid); }

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);

  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [audience, setAudience] = useState<Audience>("professional");
  const [liveContextPercent, setLiveContextPercent] = useState<number | undefined>();
  const [compacting, setCompacting] = useState(false);
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);

  const stopRef = useRef<(() => void) | null>(null);

  // Load session on mount
  useEffect(() => {
    api.getSession(sessionId).then((detail) => {
      setSession(detail.session);
      setMessages(
        detail.messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content }))
      );
      setDocuments(detail.documents);
      setArtifacts(detail.artifacts);
    }).catch(() => router.push("/"));
  }, [sessionId, router]);

  function pushTrace(type: TraceEntry["type"], extra: Partial<TraceEntry> = {}) {
    setTraceEntries((prev) => [...prev, { id: uid(), type, timestamp: Date.now(), ...extra }]);
  }

  const handleSend = useCallback(async (text: string) => {
    if (isStreaming) return;

    // Optimistically add user message
    const userMsgId = uid();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: text }]);
    setStreamingText("");
    setIsStreaming(true);
    setTraceEntries([]);

    try {
      await api.sendMessage(sessionId, text, audience);
    } catch (e) {
      setIsStreaming(false);
      return;
    }

    let accumulated = "";

    const unsubscribe = subscribeToStream(
      sessionId,
      (event: SSEEvent) => {
        switch (event.type) {
          case "text_delta":
            accumulated += event.delta;
            setStreamingText(accumulated);
            break;

          case "agent_spawned":
            pushTrace("agent_spawned", { agent_id: event.agent_id, role: event.role });
            break;

          case "tool_use":
            pushTrace("tool_use", { agent_id: event.agent_id, tool: event.tool, input: event.input });
            break;

          case "artifact_written":
            pushTrace("artifact_written", { artifact_id: event.artifact_id, artifact_name: event.name });
            // Reload artifacts
            api.getSession(sessionId).then((d) => setArtifacts(d.artifacts)).catch(() => {});
            break;

          case "agent_done":
            pushTrace("agent_done", { agent_id: event.agent_id, summary: event.summary });
            break;

          case "context_usage":
            setLiveContextPercent(event.percent);
            break;

          case "compaction_done":
            pushTrace("compaction_done", {
              before_tokens: event.before_tokens,
              after_tokens: event.after_tokens,
            });
            break;

          case "run_complete":
            setMessages((prev) => [
              ...prev,
              { id: uid(), role: "assistant", content: accumulated },
            ]);
            setStreamingText("");
            setIsStreaming(false);
            break;

          case "error":
            setMessages((prev) => [
              ...prev,
              { id: uid(), role: "assistant", content: `Error: ${event.message}` },
            ]);
            setStreamingText("");
            setIsStreaming(false);
            break;
        }
      },
      () => {
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "assistant", content: accumulated },
          ]);
          setStreamingText("");
        }
        setIsStreaming(false);
      }
    );

    stopRef.current = unsubscribe;
  }, [sessionId, audience, isStreaming]);

  function handleStop() {
    stopRef.current?.();
    stopRef.current = null;
    setIsStreaming(false);
    if (streamingText) {
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: streamingText + " [stopped]" }]);
      setStreamingText("");
    }
  }

  async function handleCompact() {
    setCompacting(true);
    await api.compact(sessionId).catch(() => {});
    setCompacting(false);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2d3148] bg-[#0f1117] shrink-0">
        <button onClick={() => router.push("/")} className="text-slate-500 hover:text-slate-300 transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <BookOpen className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-slate-300 truncate">
          {session?.title || "Deep-Reading Session"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <AudienceToggle value={audience} onChange={setAudience} />
          <ContextMeter
            sessionId={sessionId}
            livePercent={liveContextPercent}
            onCompact={handleCompact}
            compacting={compacting}
          />
        </div>
      </header>

      {/* Three-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: documents */}
        <aside className="w-56 shrink-0 border-r border-[#2d3148] flex flex-col bg-[#0f1117]">
          <div className="px-3 py-3 border-b border-[#2d3148]">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Documents</p>
            {documents.length > 0 ? (
              <ul className="space-y-1">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-start gap-1.5 text-xs text-slate-400 truncate">
                    <span className="text-slate-600 shrink-0">•</span>
                    <span className="truncate" title={d.filename}>{d.filename}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-600">No documents yet</p>
            )}
          </div>
          <div className="p-3">
            <UploadZone
              sessionId={sessionId}
              onUploaded={(doc) => setDocuments((prev) => [...prev, doc])}
            />
          </div>
        </aside>

        {/* Centre: chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatPane
            messages={messages}
            streamingText={streamingText}
            artifacts={artifacts}
            isStreaming={isStreaming}
            onSend={handleSend}
            onStop={handleStop}
            onCitationClick={(id) => setDrawerChunkId(id)}
          />
        </main>

        {/* Right: agent trace */}
        <aside className="w-72 shrink-0 border-l border-[#2d3148] overflow-hidden">
          <AgentTrace entries={traceEntries} streaming={isStreaming} />
        </aside>
      </div>

      {/* Source drawer */}
      <SourceDrawer chunkId={drawerChunkId} onClose={() => setDrawerChunkId(null)} />
    </div>
  );
}
