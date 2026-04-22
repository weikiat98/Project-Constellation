"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Pin,
  PinOff,
  Search,
  MessageSquare,
  BookOpen,
  Trash2,
  Pencil,
} from "lucide-react";
import { api, type Session } from "@/lib/api";

interface Props {
  activeSessionId?: string;
  /**
   * When true, the sidebar starts open. Users can still collapse it.
   * Default: true.
   */
  defaultOpen?: boolean;
}

export default function ChatSidebar({ activeSessionId, defaultOpen = true }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const list = await api.listSessions();
      setSessions(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [activeSessionId]);

  // Refresh when the active chat's metadata changes (e.g. auto-generated title
  // after the first user message). The session page dispatches this event.
  useEffect(() => {
    function onSessionsChanged() {
      refresh();
    }
    window.addEventListener("sessions-changed", onSessionsChanged);
    return () => window.removeEventListener("sessions-changed", onSessionsChanged);
  }, []);

  function newChat() {
    router.push("/home");
  }

  async function deleteChat(s: Session, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${s.title || "Untitled chat"}"? This cannot be undone.`)) return;
    const wasActive = s.id === activeSessionId;
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    try {
      await api.deleteSession(s.id);
      if (wasActive) router.push("/home");
    } catch {
      refresh();
    }
  }

  async function renameChat(s: Session, nextTitle: string) {
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === (s.title || "")) return;
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title: trimmed } : x)));
    try {
      await api.updateSession(s.id, { title: trimmed });
    } catch {
      refresh();
    }
  }

  async function togglePin(s: Session, e: React.MouseEvent) {
    e.stopPropagation();
    const next = !s.pinned;
    setSessions((prev) =>
      prev
        .map((x) => (x.id === s.id ? { ...x, pinned: next } : x))
        .sort((a, b) => {
          const p = Number(b.pinned ?? 0) - Number(a.pinned ?? 0);
          if (p !== 0) return p;
          return b.created_at.localeCompare(a.created_at);
        })
    );
    try {
      await api.updateSession(s.id, { pinned: next });
    } catch {
      refresh();
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter((s) => (s.title || "Untitled").toLowerCase().includes(q))
    : sessions;
  const pinned = filtered.filter((s) => s.pinned);
  const recent = filtered.filter((s) => !s.pinned);

  if (!open) {
    return (
      <aside className="w-12 shrink-0 border-r border-[#2d3148] bg-[#0b0d14] flex flex-col items-center py-3 gap-3">
        <button
          onClick={() => setOpen(true)}
          title="Open sidebar"
          className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1a1d27] transition"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <button
          onClick={newChat}
          title="New chat"
          className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#1a1d27] transition"
        >
          <Plus className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-[#2d3148] bg-[#0b0d14] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[#2d3148]">
        <button
          onClick={() => router.push("/home")}
          className="flex items-center gap-2 text-slate-200 hover:text-white transition"
          title="Home"
          suppressHydrationWarning
        >
          <BookOpen className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold">Constellation</span>
        </button>
        <button
          onClick={() => setOpen(false)}
          title="Collapse sidebar"
          className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27] transition"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pt-3">
        <button
          onClick={newChat}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white hover:bg-slate-200 text-slate-900 rounded-lg text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" /> New chat
        </button>
      </div>

      {/* Search titles */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-[#13151f] rounded-md px-2 py-1.5 border border-[#2d3148]">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
          />
        </div>
      </div>

      {/* Lists */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading && (
          <p className="text-xs text-slate-600 px-2 py-2">Loading…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-slate-600 px-2 py-2">
            {q ? "No matching chats." : "No chats yet."}
          </p>
        )}

        {pinned.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-2 pt-2 pb-1">
              Pinned
            </p>
            <ul className="space-y-0.5 mb-2">
              {pinned.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onClick={() => router.push(`/sessions/${s.id}`)}
                  onTogglePin={(e) => togglePin(s, e)}
                  onDelete={(e) => deleteChat(s, e)}
                  onRename={(title) => renameChat(s, title)}
                />
              ))}
            </ul>
          </>
        )}

        {recent.length > 0 && (
          <>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-2 pt-2 pb-1">
              Recent
            </p>
            <ul className="space-y-0.5">
              {recent.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onClick={() => router.push(`/sessions/${s.id}`)}
                  onTogglePin={(e) => togglePin(s, e)}
                  onDelete={(e) => deleteChat(s, e)}
                  onRename={(title) => renameChat(s, title)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  active,
  onClick,
  onTogglePin,
  onDelete,
  onRename,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title || "");

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(session.title || "");
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    onRename(draft);
  }

  return (
    <li>
      <div
        onClick={editing ? undefined : onClick}
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition ${
          active ? "bg-[#1a1d27]" : "hover:bg-[#13151f]"
        }`}
      >
        <MessageSquare className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { setEditing(false); setDraft(session.title || ""); }
            }}
            className="flex-1 min-w-0 bg-[#0f1117] border border-[#2d3148] rounded px-1.5 py-0.5 text-sm text-slate-100 outline-none focus:border-blue-500/50"
          />
        ) : (
          <span
            className={`flex-1 truncate text-sm ${
              active ? "text-slate-100" : "text-slate-300"
            }`}
            title={session.title || "Untitled chat"}
          >
            {session.title || "Untitled chat"}
          </span>
        )}
        <button
          onClick={startEdit}
          title="Rename chat"
          className="p-0.5 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-200 transition"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onTogglePin}
          title={session.pinned ? "Unpin" : "Pin"}
          className={`p-0.5 rounded transition ${
            session.pinned
              ? "text-amber-400 opacity-100"
              : "text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-200"
          }`}
        >
          {session.pinned ? (
            <Pin className="w-3 h-3 fill-current" />
          ) : (
            <PinOff className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={onDelete}
          title="Delete chat"
          className="p-0.5 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </li>
  );
}
