/**
 * Typed API helpers for the deep-reading assistant backend.
 */

const BASE = "/api";

export interface Session {
  id: string;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  token_usage: number | null;
  created_at: string;
}

export interface Document {
  id: string;
  session_id: string;
  filename: string;
  chunk_count: number;
}

export interface Artifact {
  id: string;
  session_id: string;
  name: string;
  content: string;
  mime_type: string;
  citations_json: string | null;
}

export interface SessionDetail {
  session: Session;
  messages: Message[];
  documents: Document[];
  artifacts: Artifact[];
}

export interface ContextUsage {
  tokens: number;
  window: number;
  percent: number;
}

export type Audience = "layperson" | "professional" | "expert";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Sessions
  createSession: (title?: string) =>
    request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  listSessions: () => request<Session[]>("/sessions"),

  getSession: (id: string) => request<SessionDetail>(`/sessions/${id}`),

  // Documents
  uploadDocument: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Document>(`/sessions/${sessionId}/documents`, {
      method: "POST",
      headers: {},           // let browser set Content-Type with boundary
      body: form,
    });
  },

  // Messages
  sendMessage: (sessionId: string, content: string, audience: Audience = "professional") =>
    request<Message>(`/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, audience }),
    }),

  // Context
  getContext: (sessionId: string) =>
    request<ContextUsage>(`/sessions/${sessionId}/context`),

  compact: (sessionId: string) =>
    request<{ compacted: boolean }>(`/sessions/${sessionId}/compact`, {
      method: "POST",
    }),

  // Artifacts
  getArtifact: (id: string) => request<Artifact>(`/artifacts/${id}`),
};
