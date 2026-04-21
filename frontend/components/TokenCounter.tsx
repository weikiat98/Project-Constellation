"use client";

import type { TokenCount } from "@/lib/api";

/**
 * Inline pre-send token counter. Shows:
 *   - Draft prompt token count (when the user has typed something)
 *   - Base context size (document index + history + tools) when idle
 * Both values come from Anthropic's free /v1/messages/count_tokens endpoint
 * via the backend, so they include the overhead the Lead orchestrator adds
 * (doc chunk index, system prompt placeholder, tool schemas).
 */
export default function TokenCounter({
  count,
  loading,
  hasDraft,
}: {
  count: TokenCount | null;
  loading: boolean;
  hasDraft: boolean;
}) {
  if (!count) {
    return (
      <div className="text-[11px] text-slate-600 tabular-nums">
        {loading ? "counting…" : "—"}
      </div>
    );
  }
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);
  return (
    <div
      className="text-[11px] text-slate-500 tabular-nums flex items-center gap-2"
      title={
        `Prompt: ${count.prompt_tokens.toLocaleString()} tokens\n` +
        `Base (docs + history + tools): ${count.base_tokens.toLocaleString()}\n` +
        `Total next turn: ${count.total_tokens.toLocaleString()} / ${count.window.toLocaleString()} (${count.percent}%)`
      }
    >
      {hasDraft ? (
        <span className="text-slate-400">
          <span className="text-blue-400">{fmt(count.prompt_tokens)}</span> prompt
          <span className="text-slate-600 mx-1">+</span>
          {fmt(count.base_tokens)} tokens
        </span>
      ) : (
        <span>{fmt(count.base_tokens)} tokens</span>
      )}
      {loading && <span className="text-slate-600 animate-pulse">·</span>}
    </div>
  );
}
