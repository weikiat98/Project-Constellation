"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Bot, Wrench, FileDown, CheckCircle2, Zap } from "lucide-react";
import type { SSEEvent } from "@/lib/sse";

export interface TraceEntry {
  id: string;
  type: SSEEvent["type"];
  agent_id?: string;
  role?: string;
  tool?: string;
  input?: Record<string, unknown>;
  artifact_id?: string;
  artifact_name?: string;
  summary?: string;
  before_tokens?: number;
  after_tokens?: number;
  timestamp: number;
}

interface Props {
  entries: TraceEntry[];
  streaming: boolean;
}

function EntryIcon({ type }: { type: TraceEntry["type"] }) {
  switch (type) {
    case "agent_spawned": return <Bot className="w-3.5 h-3.5 text-blue-400" />;
    case "tool_use": return <Wrench className="w-3.5 h-3.5 text-amber-400" />;
    case "artifact_written": return <FileDown className="w-3.5 h-3.5 text-emerald-400" />;
    case "agent_done": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "compaction_done": return <Zap className="w-3.5 h-3.5 text-purple-400" />;
    default: return <div className="w-3.5 h-3.5 rounded-full bg-slate-600" />;
  }
}

function EntryLabel({ e }: { e: TraceEntry }) {
  switch (e.type) {
    case "agent_spawned":
      return <span className="text-blue-300">Agent spawned: <em className="not-italic text-slate-300">{e.role?.slice(0, 60)}</em></span>;
    case "tool_use":
      return <span className="text-amber-300">Tool: <code className="text-xs bg-[#1e2235] px-1 rounded">{e.tool}</code></span>;
    case "artifact_written":
      return <span className="text-emerald-300">Artifact: <em className="not-italic text-slate-300">{e.artifact_name}</em></span>;
    case "agent_done":
      return <span className="text-emerald-300">Agent done</span>;
    case "compaction_done":
      return (
        <span className="text-purple-300">
          Context compacted: {e.before_tokens?.toLocaleString()} → {e.after_tokens?.toLocaleString()} tokens
        </span>
      );
    default:
      return <span className="text-slate-400">{e.type}</span>;
  }
}

function EntryDetail({ e }: { e: TraceEntry }) {
  if (e.type === "tool_use" && e.input) {
    return (
      <pre className="text-xs bg-[#13151f] rounded p-2 mt-1 overflow-x-auto text-slate-400">
        {JSON.stringify(e.input, null, 2)}
      </pre>
    );
  }
  if (e.type === "agent_done" && e.summary) {
    return <p className="text-xs text-slate-400 mt-1 line-clamp-3">{e.summary}</p>;
  }
  return null;
}

export default function AgentTrace({ entries, streaming }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full bg-[#13151f]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2d3148]">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Bot className="w-4 h-4 text-blue-400" />
          Agent Trace
          {streaming && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              live
            </span>
          )}
        </div>
        <button onClick={() => setCollapsed((c) => !c)} className="text-slate-500 hover:text-slate-300">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {entries.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-8">
              Agent events will appear here during a run.
            </p>
          )}
          {entries.map((e) => (
            <div key={e.id} className="rounded">
              <button
                onClick={() => toggle(e.id)}
                className="w-full flex items-start gap-2 px-2 py-1.5 hover:bg-[#1a1d27] rounded text-left"
              >
                <EntryIcon type={e.type} />
                <span className="flex-1 text-xs leading-relaxed">
                  <EntryLabel e={e} />
                </span>
                <span className="text-[10px] text-slate-600 shrink-0 pt-0.5">
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </button>
              {expanded.has(e.id) && (
                <div className="px-7 pb-1">
                  <EntryDetail e={e} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
