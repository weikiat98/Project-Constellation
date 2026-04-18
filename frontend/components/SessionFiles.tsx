"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Upload, Sparkles } from "lucide-react";
import type { Artifact, Document } from "@/lib/api";

interface SessionFilesProps {
  documents: Document[];
  artifacts: Artifact[];
  onUploadClick: () => void;
  onArtifactClick: (artifact: Artifact) => void;
}

export default function SessionFiles({
  documents,
  artifacts,
  onUploadClick,
  onArtifactClick,
}: SessionFilesProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const total = documents.length + artifacts.length;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-300 hover:text-slate-100 hover:bg-[#1a1d27] border border-[#2d3148] transition"
        title="Session files"
      >
        <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
        <span>Session files</span>
        {total > 0 && (
          <span className="text-slate-500">({total})</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#13151f] border border-[#2d3148] rounded-lg shadow-xl z-20 overflow-hidden">
          {/* Inputs */}
          <div className="px-3 py-2 border-b border-[#2d3148]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Inputs ({documents.length})
              </span>
              <button
                onClick={() => { setOpen(false); onUploadClick(); }}
                className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                title="Upload document"
              >
                <Upload className="w-3 h-3" /> Upload
              </button>
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-slate-600 py-1">No documents uploaded.</p>
            ) : (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start gap-1.5 text-xs text-slate-300 py-0.5"
                    title={`${d.filename} — ${d.chunk_count} chunks`}
                  >
                    <FileText className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                    <span className="truncate flex-1">{d.filename}</span>
                    <span className="text-slate-600 text-[10px] shrink-0">{d.chunk_count}c</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Outputs */}
          <div className="px-3 py-2">
            <div className="mb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Outputs ({artifacts.length})
              </span>
            </div>
            {artifacts.length === 0 ? (
              <p className="text-xs text-slate-600 py-1">No artifacts generated yet.</p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {artifacts.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => { setOpen(false); onArtifactClick(a); }}
                      className="w-full flex items-start gap-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-[#1a1d27] rounded px-1 py-0.5 text-left transition"
                      title={a.name}
                    >
                      <Sparkles className="w-3 h-3 text-purple-400 shrink-0 mt-0.5" />
                      <span className="truncate flex-1">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
