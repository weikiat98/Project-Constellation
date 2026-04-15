"use client";

import { Download, FileText } from "lucide-react";
import type { Artifact } from "@/lib/api";

interface Props {
  artifact: Artifact;
}

function mimeIcon(mime: string) {
  if (mime === "text/html") return "HTML";
  if (mime === "text/csv") return "CSV";
  return "MD";
}

export default function ArtifactCard({ artifact }: Props) {
  function download() {
    const ext =
      artifact.mime_type === "text/html"
        ? "html"
        : artifact.mime_type === "text/csv"
        ? "csv"
        : "md";
    const blob = new Blob([artifact.content], { type: artifact.mime_type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.name}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-[#1a1d27] rounded-lg border border-[#2d3148]">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-emerald-400" />
        <div>
          <div className="text-sm text-slate-200 font-medium">{artifact.name}</div>
          <div className="text-xs text-slate-500">{mimeIcon(artifact.mime_type)}</div>
        </div>
      </div>
      <button
        onClick={download}
        className="p-1.5 hover:bg-[#2d3148] rounded text-slate-400 hover:text-slate-200 transition"
        title="Download"
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
}
