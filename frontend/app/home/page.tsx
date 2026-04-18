"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Plus, Upload as UploadIcon, X, FileText, Loader2, CheckCircle } from "lucide-react";
import ChatSidebar from "@/components/ChatSidebar";
import { api, type Audience, type Document } from "@/lib/api";
import AudienceToggle from "@/components/AudienceToggle";

function greeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [audience, setAudience] = useState<Audience>("professional");
  const [submitting, setSubmitting] = useState(false);
  const [greet, setGreet] = useState("Welcome");

  // A draft session is created on first upload so files can attach somewhere.
  // If the user never sends, we leave the session in place (they can delete from the sidebar).
  const [draftId, setDraftId] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGreet(greeting(new Date().getHours()));
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    }
    if (plusOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [plusOpen]);

  async function ensureDraft(): Promise<string> {
    if (draftId) return draftId;
    const session = await api.createSession();
    setDraftId(session.id);
    return session.id;
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const sid = await ensureDraft();
      const doc = await api.uploadDocument(sid, file);
      setPendingDocs((prev) => [...prev, doc]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removePending(id: string) {
    setPendingDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function startChat() {
    const text = input.trim();
    if (submitting) return;
    if (!text && pendingDocs.length === 0) return;
    setSubmitting(true);
    try {
      const sid = draftId ?? (await api.createSession()).id;
      const params = new URLSearchParams();
      if (text) {
        params.set("prompt", text);
        params.set("audience", audience);
      }
      const qs = params.toString();
      router.push(`/sessions/${sid}${qs ? `?${qs}` : ""}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0b10]">
      <ChatSidebar />

      <main className="flex-1 flex flex-col">
        {/* Top bar with audience toggle */}
        <header className="h-14 shrink-0 flex items-center justify-center px-6 border-b border-[#2d3148]">
          <AudienceToggle value={audience} onChange={setAudience} />
        </header>

        {/* Centred welcome + chat bar */}
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <h1 className="text-4xl font-semibold text-slate-100 mb-3 text-center">
              {greet}.
            </h1>
            <p className="text-slate-400 text-base mb-10 text-center">
              Ask a question or upload a document to begin.
            </p>

            <div className="w-full bg-[#1a1d27] rounded-2xl border border-[#2d3148] px-3 py-2 focus-within:border-blue-500/40 transition">
              {/* Attached document chips */}
              {pendingDocs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
                  {pendingDocs.map((d) => (
                    <span
                      key={d.id}
                      className="flex items-center gap-1.5 px-2 py-1 bg-[#2d3148] rounded-md text-xs text-slate-200"
                    >
                      <FileText className="w-3 h-3 text-blue-400" />
                      <span className="max-w-[12rem] truncate" title={d.filename}>{d.filename}</span>
                      <button
                        onClick={() => removePending(d.id)}
                        className="text-slate-500 hover:text-red-400"
                        title="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2">
                <div className="relative" ref={plusRef}>
                  <button
                    onClick={() => setPlusOpen((v) => !v)}
                    className="p-2 text-slate-400 hover:text-slate-100 hover:bg-[#2d3148] rounded-lg transition"
                    title="Add"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {plusOpen && (
                    <div className="absolute bottom-full mb-2 left-0 bg-[#13151f] border border-[#2d3148] rounded-lg shadow-xl py-1 min-w-[160px] z-10">
                      <button
                        onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-[#1a1d27] transition text-left"
                      >
                        <UploadIcon className="w-3.5 h-3.5" />
                        Upload files
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.txt,.md,.html"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                      e.target.value = "";
                    }}
                  />
                </div>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      startChat();
                    }
                  }}
                  disabled={submitting}
                  placeholder="How can I help with your document today?"
                  rows={2}
                  className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 resize-none outline-none leading-relaxed max-h-40 overflow-y-auto disabled:opacity-60 py-2"
                />

                <button
                  onClick={startChat}
                  disabled={submitting || (!input.trim() && pendingDocs.length === 0)}
                  className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition"
                  title="Start chat"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {(uploading || uploadError) && (
                <div className="flex items-center gap-2 pt-2 pb-1 px-1 text-xs">
                  {uploading && (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                      <span className="text-slate-400">Ingesting…</span>
                    </>
                  )}
                  {!uploading && uploadError && (
                    <span className="text-red-400">{uploadError}</span>
                  )}
                </div>
              )}
              {pendingDocs.length > 0 && !uploading && (
                <div className="flex items-center gap-1.5 pt-1 pb-1 px-1 text-xs text-emerald-400">
                  <CheckCircle className="w-3 h-3" />
                  <span>{pendingDocs.length} ready</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
