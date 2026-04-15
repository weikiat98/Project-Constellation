/**
 * Typed EventSource wrapper for the agent SSE stream.
 */

export type SSEEventType =
  | "agent_spawned"
  | "text_delta"
  | "tool_use"
  | "artifact_written"
  | "agent_done"
  | "run_complete"
  | "context_usage"
  | "compaction_done"
  | "error";

export interface AgentSpawnedEvent {
  type: "agent_spawned";
  agent_id: string;
  role: string;
  parent: string | null;
}

export interface TextDeltaEvent {
  type: "text_delta";
  agent_id: string;
  delta: string;
}

export interface ToolUseEvent {
  type: "tool_use";
  agent_id: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface ArtifactWrittenEvent {
  type: "artifact_written";
  artifact_id: string;
  name: string;
}

export interface AgentDoneEvent {
  type: "agent_done";
  agent_id: string;
  summary: string;
}

export interface RunCompleteEvent {
  type: "run_complete";
  final: string;
}

export interface ContextUsageEvent {
  type: "context_usage";
  tokens: number;
  window: number;
  percent: number;
}

export interface CompactionDoneEvent {
  type: "compaction_done";
  before_tokens: number;
  after_tokens: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent =
  | AgentSpawnedEvent
  | TextDeltaEvent
  | ToolUseEvent
  | ArtifactWrittenEvent
  | AgentDoneEvent
  | RunCompleteEvent
  | ContextUsageEvent
  | CompactionDoneEvent
  | ErrorEvent;

export type SSEHandler = (event: SSEEvent) => void;

export function subscribeToStream(
  sessionId: string,
  onEvent: SSEHandler,
  onClose?: () => void
): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/stream`);

  es.onmessage = (e) => {
    try {
      const parsed: SSEEvent = JSON.parse(e.data);
      onEvent(parsed);
      if (parsed.type === "run_complete" || parsed.type === "error") {
        es.close();
        onClose?.();
      }
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    es.close();
    onClose?.();
  };

  return () => es.close();
}
