"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import type { TraceEntry } from "./AgentTrace";
import AgentTrace from "./AgentTrace";

interface Props {
  entries: TraceEntry[];
  streaming: boolean;
}

/**
 * Inline collapsible agent-trace panel. Lives above the chat input.
 * Collapsed: thin strip with live indicator + event count + "View more".
 * Expanded: scrollable AgentTrace list that auto-scrolls to the latest event.
 */
export default function AgentTracePanel({ entries, streaming }: Props) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-open when streaming starts and auto-scroll to bottom on new events.
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, open]);

  return (
    <div className="border-t border-[#2d3148] bg-[#0f1117]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-[#13151f] transition"
      >
        <Activity className="w-3.5 h-3.5 text-blue-400" />
        <span className="font-medium">Agent trace</span>
        {streaming && (
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            live
          </span>
        )}
        <span className="text-slate-500">
          {entries.length} {entries.length === 1 ? "event" : "events"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {open ? "View less" : "View more"}
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </span>
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto border-t border-[#2d3148] scroll-smooth"
        >
          <AgentTrace entries={entries} streaming={streaming} embedded />
        </div>
      )}
    </div>
  );
}
