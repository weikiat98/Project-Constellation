"use client";

import { useEffect, useState } from "react";
import { Cpu, Zap } from "lucide-react";
import { api, type ContextUsage } from "@/lib/api";

interface Props {
  sessionId: string;
  livePercent?: number; // updated via SSE
  onCompact: () => void;
  compacting: boolean;
}

export default function ContextMeter({ sessionId, livePercent, onCompact, compacting }: Props) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  useEffect(() => {
    api.getContext(sessionId).then(setUsage).catch(() => {});
  }, [sessionId]);

  const percent = livePercent ?? usage?.percent ?? 0;
  const color =
    percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-400" : "bg-emerald-400";
  const textColor =
    percent >= 90 ? "text-red-400" : percent >= 70 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-[#1a1d27] rounded-lg text-xs">
      <Cpu className="w-3.5 h-3.5 text-slate-400" />
      <span className="text-slate-400">Context</span>
      <span className={`font-mono font-semibold ${textColor}`}>{percent.toFixed(0)}%</span>
      <div className="w-20 h-1.5 bg-[#2d3148] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {percent >= 70 && (
        <button
          onClick={onCompact}
          disabled={compacting}
          className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs disabled:opacity-50 transition"
        >
          <Zap className="w-3 h-3" />
          {compacting ? "Compacting…" : "Compact"}
        </button>
      )}
    </div>
  );
}
