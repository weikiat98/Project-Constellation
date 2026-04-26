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
  if (mime === "text/plain") return "TXT";
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
      // Card hugs the title (with a sensible cap) instead of always stretching
      // to the bubble width — short titles produce a small chip, long titles
      // expand up to ~24rem and then truncate.
      className="inline-flex max-w-sm items-center gap-2 px-3 py-2 bg-[#1a1d27] rounded-lg border border-[#2d3148] hover:border-blue-500/40 hover:bg-[#1e2235] transition text-left"
      title="Open preview"
    >
      <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm text-slate-200 font-medium truncate">{artifact.name}</div>
        <div className="text-[11px] text-slate-500">{mimeIcon(artifact.mime_type)}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-1">
        {onPreview && (
          <span
            className="p-1 rounded text-slate-400"
            aria-hidden
          >
            <Eye className="w-3.5 h-3.5" />
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={download}
          onKeyDown={(e) => { if (e.key === "Enter") download(e as unknown as React.MouseEvent); }}
          className="p-1 hover:bg-[#2d3148] rounded text-slate-400 hover:text-slate-200 transition cursor-pointer"
          title="Download"
        >
          <Download className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
}
