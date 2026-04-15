"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2, CheckCircle } from "lucide-react";
import { api, type Document } from "@/lib/api";

interface Props {
  sessionId: string;
  onUploaded: (doc: Document) => void;
}

export default function UploadZone({ sessionId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    setDone(false);
    try {
      const doc = await api.uploadDocument(sessionId, file);
      onUploaded(doc);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition select-none ${
        dragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-[#2d3148] hover:border-[#4a5175] bg-[#13151f]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.txt,.md,.html"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {uploading ? (
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <span className="text-sm">Ingesting document…</span>
        </div>
      ) : done ? (
        <div className="flex flex-col items-center gap-2 text-emerald-400">
          <CheckCircle className="w-8 h-8" />
          <span className="text-sm">Document ready</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <div className="flex gap-2">
            <Upload className="w-5 h-5" />
            <FileText className="w-5 h-5" />
          </div>
          <span className="text-sm font-medium text-slate-300">Drop a file or click to upload</span>
          <span className="text-xs">PDF · DOCX · TXT · MD · HTML</span>
          {error && <span className="text-xs text-red-400 mt-1">{error}</span>}
        </div>
      )}
    </div>
  );
}
