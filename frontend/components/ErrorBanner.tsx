"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  layman: string;
  technical?: string;
  code?: string;
  status?: number | null;
}

// Inline chat banner for orchestrator errors. The plain-English (layman)
// message is shown by default so non-technical users get an actionable
// explanation; the engineer-facing details are tucked behind a toggle so
// developers / support can copy them into a bug report.
export default function ErrorBanner({ layman, technical, code, status }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasTechnical = Boolean(technical && technical.trim().length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl my-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-red-100 leading-snug">{layman}</div>

          {hasTechnical && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-red-300/80 hover:text-red-200 transition"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? "Hide technical details" : "Show technical details"}
            </button>
          )}

          {expanded && hasTechnical && (
            <div className="mt-2 rounded-md border border-red-500/20 bg-[#0d0e14] px-3 py-2 font-mono text-[11px] text-red-200/90 break-all">
              {(code || status != null) && (
                <div className="mb-1 text-red-300/70">
                  {code ? <span>code: {code}</span> : null}
                  {code && status != null ? <span> · </span> : null}
                  {status != null ? <span>status: {status}</span> : null}
                </div>
              )}
              <div>{technical}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
