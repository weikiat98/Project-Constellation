"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Plus, Upload as UploadIcon, X, FileText, Loader2, CheckCircle } from "lucide-react";
import ChatSidebar from "@/components/ChatSidebar";
import TokenCounter from "@/components/TokenCounter";
import { api, type Audience, type Document, type TokenCount } from "@/lib/api";
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
  const [dragging, setDragging] = useState(false);
  const [tokenCount, setTokenCount] = useState<TokenCount | null>(null);
  const [countingTokens, setCountingTokens] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Debounced live token count. Uses the backend endpoint when a draft session
  // exists (so uploaded-document tokens are included); otherwise falls back to
  // a local ~4-chars-per-token estimate so users still see a number before
  // uploading anything.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draftId) {
        setCountingTokens(true);
        api.countTokens(draftId, input, pendingDocs.map((d) => d.id))
          .then((tc) => setTokenCount(tc))
          .catch(() => {})
          .finally(() => setCountingTokens(false));
      } else {
        // Local estimate: ~4 characters per token is Anthropic's own heuristic.
        const promptTokens = Math.ceil(input.length / 4);
        setTokenCount({
          prompt_tokens: promptTokens,
          base_tokens: 0,
          total_tokens: promptTokens,
          window: 200000,
          percent: Math.round((promptTokens / 200000) * 1000) / 10,
        });
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [input, draftId, pendingDocs.length]);

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

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      await handleUpload(file);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragging) setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when leaving the outer container (not a child element).
    if (e.currentTarget === e.target) setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) handleFiles(files);
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

      <main
        className="flex-1 flex flex-col relative"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Top bar with audience toggle */}
        <header className="h-14 shrink-0 flex items-center justify-center px-6 border-b border-[#2d3148]">
          <AudienceToggle value={audience} onChange={setAudience} />
        </header>

        {/* Drag-and-drop overlay */}
        {dragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-blue-600/10 border-2 border-dashed border-blue-500/70 pointer-events-none">
            <div className="px-5 py-3 rounded-lg bg-[#13151f] border border-blue-500/60 text-sm text-blue-200 font-medium">
              Drop files to upload
            </div>
          </div>
        )}

        {/* Welcome + chat bar — top-biased so the input bar sits where the
            greeting used to appear when the block was fully centred.
            pt-[22vh] puts the greeting roughly 22% down; with mb-2 + mb-6
            the input lands at ~30–33% which matches where the h1 was. */}
        <div className="flex-1 flex flex-col items-center px-6 pt-[22vh]">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <h1 className="text-4xl font-semibold text-slate-100 mb-2 text-center">
              {greet}.
            </h1>
            <p className="text-slate-400 text-base mb-6 text-center">
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
                    multiple
                    className="hidden"
                    accept=".pdf,.docx,.txt,.md,.html"
                    onChange={(e) => {
                      if (e.target.files?.length) handleFiles(e.target.files);
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
                  className="p-2 bg-white hover:bg-slate-200 disabled:opacity-40 text-slate-900 rounded-lg transition"
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

              {/* Live token counter — mirrors the session-page placement. */}
              <div className="flex items-center justify-end pt-2 border-t border-[#2d3148]/50 mt-2">
                <TokenCounter
                  count={tokenCount}
                  loading={countingTokens}
                  hasDraft={input.trim().length > 0}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
