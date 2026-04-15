"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, BookOpen, Clock } from "lucide-react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listSessions().then(setSessions).finally(() => setLoading(false));
  }, []);

  async function newSession() {
    const s = await api.createSession();
    router.push(`/sessions/${s.id}`);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <BookOpen className="w-10 h-10 text-blue-400" />
            <h1 className="text-3xl font-bold text-slate-100">Deep-Reading Assistant</h1>
          </div>
          <p className="text-slate-400 text-lg">
            Multi-agent analysis for legal acts, regulations, academic papers, and policy documents.
            Every claim is cited. Every answer is verifiable.
          </p>
        </div>

        <button
          onClick={newSession}
          className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-lg transition mb-8"
        >
          <Plus className="w-5 h-5" />
          New Reading Session
        </button>

        {!loading && sessions.length > 0 && (
          <div>
            <h2 className="text-slate-400 text-sm font-medium mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent sessions
            </h2>
            <ul className="space-y-2">
              {sessions.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => router.push(`/sessions/${s.id}`)}
                    className="w-full text-left px-4 py-3 bg-[#1a1d27] hover:bg-[#22263a] rounded-lg transition"
                  >
                    <div className="text-slate-200 font-medium truncate">
                      {s.title || "Untitled session"}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      {new Date(s.created_at).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
