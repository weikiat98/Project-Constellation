"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { api, type Document } from "@/lib/api";
import { classifyClientError, type ClientErrorPayload } from "@/lib/clientErrors";

interface Props {
  sessionId: string;
  onUploaded: (doc: Document) => void;
}

export default function UploadZone({ sessionId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ClientErrorPayload | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    setShowTechnical(false);
    setDone(false);
    try {
      for (const file of list) {
        const doc = await api.uploadDocument(sessionId, file);
        onUploaded(doc);
      }
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e: unknown) {
      setError(classifyClientError(e, "upload"));
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
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
        multiple
        className="hidden"
        accept=".pdf,.docx,.txt,.md,.html"
        onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
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
          <span className="text-sm font-medium text-slate-300">Drop files or click to upload</span>
          <span className="text-xs">PDF · DOCX · TXT · MD · HTML</span>
          {error && (
            <div
              className="mt-2 w-full text-left rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-red-100 leading-snug">{error.layman}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTechnical((v) => !v);
                    }}
                    className="mt-1 text-[10px] text-red-300/80 hover:text-red-200 underline"
                  >
                    {showTechnical ? "Hide technical details" : "Show technical details"}
                  </button>
                  {showTechnical && (
                    <div className="mt-1 font-mono text-[10px] text-red-200/90 break-all">
                      {error.status != null && <div>code: {error.code} · status: {error.status}</div>}
                      <div>{error.technical}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
