"use client";

import { useEffect, useState } from "react";
import { X, FileText, Hash, BookOpen } from "lucide-react";
import { normalizeChunkId } from "@/lib/citations";

interface Chunk {
  id: string;
  content: string;
  filename?: string;
  idx?: number;
  section_id?: string;
  page?: number;
}

interface Props {
  chunkId: string | null;
  onClose: () => void;
}

export default function SourceDrawer({ chunkId, onClose }: Props) {
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chunkId) {
      setChunk(null);
      return;
    }
    const normalizedChunkId = normalizeChunkId(chunkId);
    // AbortController prevents a stale in-flight response from overwriting
    // the displayed chunk when the user clicks A then quickly clicks B.
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/chunks/${normalizedChunkId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setChunk(data))
      .catch((err) => {
        if (err?.name !== "AbortError") setChunk(null);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [chunkId]);

  if (!chunkId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-lg bg-[#13151f] border-l border-[#2d3148] flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <BookOpen className="w-4 h-4 text-blue-400" />
            Source preview
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Metadata */}
        {chunk && (
          <div className="px-4 py-2 border-b border-[#2d3148] text-xs text-slate-500 space-y-1">
            {chunk.filename && (
              <div className="flex items-center gap-1.5 text-slate-300">
                <FileText className="w-3 h-3 text-blue-400" />
                <span className="truncate" title={chunk.filename}>{chunk.filename}</span>
              </div>
            )}
            <div className="flex items-center gap-4">
              {typeof chunk.page === "number" && <span>Page {chunk.page}</span>}
              {chunk.section_id && (
                <span className="flex items-center gap-1">
                  <FileText className="w-3 h-3" /> §{chunk.section_id}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Hash className="w-3 h-3" /> {chunk.id.slice(0, 8)}
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-slate-500 text-sm">Loading source passage</p>}
          {!loading && !chunk && (
            <p className="text-slate-500 text-sm">
              Source passage not available.
              <br />
              <span className="text-xs">(Chunk ID: {chunkId})</span>
            </p>
          )}
          {chunk && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
              {chunk.content}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
