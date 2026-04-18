"use client";

import { Download, FileText, Eye } from "lucide-react";
import type { Artifact } from "@/lib/api";
import { downloadArtifact } from "@/lib/citations";

interface Props {
  artifact: Artifact;
  onPreview?: (a: Artifact) => void;
}

function mimeIcon(mime: string) {
  if (mime === "text/html") return "HTML";
  if (mime === "text/csv") return "CSV";
  return "MD";
}

export default function ArtifactCard({ artifact, onPreview }: Props) {
  function download(e: React.MouseEvent) {
    e.stopPropagation();
    void downloadArtifact(artifact);
  }

  function openPreview() {
    onPreview?.(artifact);
  }

  return (
    <button
      type="button"
      onClick={openPreview}
      className="w-full flex items-center justify-between px-3 py-2 bg-[#1a1d27] rounded-lg border border-[#2d3148] hover:border-blue-500/40 hover:bg-[#1e2235] transition text-left"
      title="Open preview"
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm text-slate-200 font-medium truncate">{artifact.name}</div>
          <div className="text-xs text-slate-500">{mimeIcon(artifact.mime_type)}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onPreview && (
          <span
            className="p-1.5 rounded text-slate-400 group-hover:text-slate-200"
            aria-hidden
          >
            <Eye className="w-4 h-4" />
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={download}
          onKeyDown={(e) => { if (e.key === "Enter") download(e as unknown as React.MouseEvent); }}
          className="p-1.5 hover:bg-[#2d3148] rounded text-slate-400 hover:text-slate-200 transition cursor-pointer"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </span>
      </div>
    </button>
  );
}
