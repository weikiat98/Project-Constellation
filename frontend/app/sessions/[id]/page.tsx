"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { X, Upload as UploadIcon, Pencil, Check } from "lucide-react";
import { api, type Artifact, type Document, type Session, type Audience } from "@/lib/api";
import { subscribeToStream, type SSEEvent } from "@/lib/sse";
import ChatPane, { type ChatMessage } from "@/components/ChatPane";
import { clearCitationCache } from "@/components/CitationLink";
import type { TraceEntry } from "@/components/AgentTrace";
import UploadZone from "@/components/UploadZone";
import AudienceToggle from "@/components/AudienceToggle";
import SourceDrawer from "@/components/SourceDrawer";
import ChatSidebar from "@/components/ChatSidebar";
import ArtifactPreview from "@/components/ArtifactPreview";
import SessionFiles from "@/components/SessionFiles";

let _uid = 0;
function uid() { return String(++_uid); }

// Convert a raw server message to ChatMessage shape.
function mapServerMessage(m: {
  id: string;
  role: string;
  content: string;
  artifact_ids?: string[];
  thinking?: string | null;
  attached_documents?: string[];
}): ChatMessage {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    artifactIds: m.artifact_ids && m.artifact_ids.length ? m.artifact_ids : undefined,
    thinking: m.thinking || undefined,
    attachedDocs: m.attached_documents && m.attached_documents.length ? m.attached_documents : undefined,
  };
}

// Merge server messages with transient system banners from current local state.
// Each banner is anchored to the count of non-system messages that preceded
// it locally, so it survives both reloads and message-truncation operations
// (retry/edit) — even when the next persisted message that originally followed
// the banner has been deleted from the server. The original ID-based anchor
// dropped any banner whose next-message ID was no longer in `serverMsgs`.
function mergeWithBanners(prev: ChatMessage[], serverMsgs: ChatMessage[]): ChatMessage[] {
  // Collect banners + the count of non-system messages preceding each one.
  const banners: Array<{ banner: ChatMessage; precedingCount: number }> = [];
  let count = 0;
  for (const m of prev) {
    if (m.role === "system") {
      banners.push({ banner: m, precedingCount: count });
    } else {
      count += 1;
    }
  }
  if (banners.length === 0) return serverMsgs;

  // Cap each anchor at the new server-message count so banners that pointed
  // past the (now-truncated) tail collapse to the end instead of disappearing.
  const result: ChatMessage[] = [];
  let inserted = 0;
  for (let i = 0; i < serverMsgs.length; i++) {
    while (
      inserted < banners.length &&
      Math.min(banners[inserted].precedingCount, serverMsgs.length) === i
    ) {
      result.push(banners[inserted].banner);
      inserted += 1;
    }
    result.push(serverMsgs[i]);
  }
  while (inserted < banners.length) {
    result.push(banners[inserted].banner);
    inserted += 1;
  }
  return result;
}

// Detect explicit audience signals in a prompt. Returns the inferred audience
// or null if the prompt contains no explicit instruction.
// Only fires on clear, unambiguous phrasings so casual language doesn't
// accidentally override the user's toggle choice.
function inferAudience(text: string): import("@/lib/api").Audience | null {
  const t = text.toLowerCase();

  const laypersonPatterns = [
    /\blayman'?s?\s+terms?\b/,
    /\blayperson\b/,
    /\bsimple\s+(terms?|language|english|words?|explanation|way)\b/,
    /\bexplain\s+(it\s+)?simply\b/,
    /\bplain\s+(english|language|terms?|words?)\b/,
    /\beas(y|ily)\s+to\s+understand\b/,
    /\bnon[- ]?technical\b/,
    /\bno\s+jargon\b/,
    /\blike\s+i'?m?\s+(a\s+)?(5|five|kid|child|beginner|novice|dummy)\b/,
    /\beli5\b/,
    /\bsimplif(y|ied)\b/,
  ];

  const expertPatterns = [
    /\bexpert\s+(level|terms?|language|analysis|view)\b/,
    /\btechnical\s+(terms?|language|detail|analysis|explanation)\b/,
    /\bin\s+depth\s+technical\b/,
    /\bprecise\s+(legal|technical)\b/,
    /\bfull\s+(legal|technical)\s+(detail|analysis)\b/,
    /\bassume\s+(i\s+am|i'?m|we\s+are|we'?re)\s+(an?\s+)?(expert|professional|lawyer|specialist|engineer)\b/,
  ];

  const professionalPatterns = [
    /\bprofessional\s+(terms?|language|tone|explanation|summary)\b/,
    /\bfor\s+a\s+professional\b/,
    /\bbusiness\s+(language|terms?|context)\b/,
    /\bdomain\s+terminology\b/,
  ];

  if (laypersonPatterns.some((p) => p.test(t))) return "layperson";
  if (expertPatterns.some((p) => p.test(t))) return "expert";
  if (professionalPatterns.some((p) => p.test(t))) return "professional";
  return null;
}

function persistedToTrace(e: {
  run_index: number;
  seq: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}): TraceEntry {
  const ts = Date.parse(e.created_at) || Date.now();
  const p = e.payload || {};
  return {
    id: `p-${e.run_index}-${e.seq}`,
    type: e.event_type as TraceEntry["type"],
    timestamp: ts,
    agent_id: p.agent_id as string | undefined,
    role: p.role as string | undefined,
    tool: p.tool as string | undefined,
    input: p.input as Record<string, unknown> | undefined,
    artifact_id: p.artifact_id as string | undefined,
    artifact_name: p.name as string | undefined,
    summary: p.summary as string | undefined,
    before_tokens: p.before_tokens as number | undefined,
    after_tokens: p.after_tokens as number | undefined,
  };
}

export default function SessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);

  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  // Artifact IDs produced during the currently-streaming turn. Rendered as
  // "Generated files" rows inside the live assistant bubble so the user sees
  // the download button appear while the recap is still typing in.
  const [runArtifactIds, setRunArtifactIds] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>("professional");
  const [liveContextPercent, setLiveContextPercent] = useState<number | undefined>();
  const [compacting, setCompacting] = useState(false);
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const stopRef = useRef<(() => void) | null>(null);
  const uploadCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didAttachInitial = useRef(false);
  // Hydrate audience from the server once per session id. This prevents
  // search-param-only rerenders (e.g. router.replace stripping ?prompt) from
  // clobbering a freshly selected audience with stale persisted state.
  const didHydrateAudienceForSession = useRef<string | null>(null);
  // Audience ref keeps the mount effect's closure free of `audience` as a
  // dependency, so manual toggles don't re-fire the effect (and trigger
  // extra getSession round-trips). The mount handoff reads the latest
  // audience from this ref instead of the captured prop.
  const audienceRef = useRef<Audience>(audience);
  useEffect(() => {
    audienceRef.current = audience;
  }, [audience]);

  const attachStream = useCallback(() => {
    // Close any prior EventSource before opening a new one. attachStream is
    // called from mount, send, retry, edit, and the /home handoff — without
    // this guard, rapid successive calls leak parallel SSE connections to
    // the same session.
    stopRef.current?.();
    stopRef.current = null;

    setStreamingText("");
    setThinkingText("");
    setIsStreaming(true);
    let accumulatedThinking = "";
    let accumulatedText = "";
    // Artifacts produced *during this run*. Tracked in a per-invocation
    // local array; we always derive React state from this single source so
    // there's no shared mutable state across overlapping attachStream calls.
    const runArtifactIds: string[] = [];
    setRunArtifactIds([]);
    // Defer the artifact preview auto-open until the recap has streamed
    // so the user reads the chat reply before the canvas pops open.
    let pendingPreviewArtifactId: string | null = null;
    // Paced streaming: SSE deltas can arrive in uneven bursts, which causes
    // jumpy text if rendered immediately. We decouple network cadence from
    // paint cadence by advancing visible text based on elapsed time, then
    // apply a soft catch-up when the hidden buffer gets too far ahead.
    const TEXT_CHARS_PER_SEC = 95;
    const FINAL_TEXT_CHARS_PER_SEC = 110;
    const THINKING_CHARS_PER_SEC = 90;
    // Per-frame cap above the soft-catchup cap so steady-state pacing is
    // unaffected (typical step at 60fps is ~2 chars), but catch-up bursts
    // after a tab returns from background are bounded so the bubble doesn't
    // dump hundreds of chars in one paint.
    const TEXT_MAX_CHARS_PER_FRAME = 12;
    const THINKING_MAX_CHARS_PER_FRAME = 16;
    const SOFT_CATCHUP_THRESHOLD = 3000;
    const SOFT_CATCHUP_MAX_STEP = 10;
    let displayedText = "";
    let displayedThinking = "";
    let pacingRafId: number | null = null;
    let lastPaceTs = 0;
    let sawFinalMessage = false;
    // Tracks the run_complete commit-poll interval so navigation/unmount can
    // clear it. Without this, navigating away mid-pacing leaves the interval
    // ticking and calling setState on an unmounted component (memory leak +
    // React warnings).
    let commitPollId: number | null = null;
    // True once `run_complete` has begun its commit path (immediate or via the
    // pacing-done poll). The SSE `onClose` callback uses this to skip its
    // refetch — otherwise the close fires right after run_complete and races
    // the in-flight commit, potentially clobbering fresh state.
    let commitStarted = false;
    // Set when this attachStream invocation is being torn down (retry, edit,
    // navigation). cancelAnimationFrame can race with an in-flight tick that's
    // already past the cancellation checkpoint — the flag lets tick() bail
    // before calling setState from this stale closure into a fresh stream.
    let cancelled = false;

    const advance = (
      displayed: string,
      target: string,
      charsPerSecond: number,
      dtMs: number,
      maxCharsPerFrame: number,
      allowSoftCatchup: boolean
    ): string => {
      if (displayed.length >= target.length) return displayed;
      const remaining = target.length - displayed.length;
      const baseStep = Math.max(1, Math.floor((charsPerSecond * dtMs) / 1000));
      let step = Math.min(baseStep, maxCharsPerFrame);
      if (allowSoftCatchup && remaining > SOFT_CATCHUP_THRESHOLD) {
        step = Math.max(step, Math.min(SOFT_CATCHUP_MAX_STEP, Math.ceil(remaining / 900)));
      }
      step = Math.min(step, remaining);
      return target.slice(0, displayed.length + step);
    };

    const tick = (ts: number) => {
      pacingRafId = null;
      // Stale-closure guard: if this attachStream invocation was cancelled
      // (retry/edit/navigation) between the RAF being scheduled and tick()
      // actually firing, skip — otherwise we'd setState from the old closure
      // into the new stream's bubble and flash stale text.
      if (cancelled) return;
      if (!lastPaceTs) lastPaceTs = ts;
      const dtMs = Math.min(64, Math.max(8, ts - lastPaceTs));
      lastPaceTs = ts;
      let needAnotherFrame = false;

      // Text channel pacing.
      if (displayedText.length < accumulatedText.length) {
        displayedText = advance(
          displayedText,
          accumulatedText,
          sawFinalMessage ? FINAL_TEXT_CHARS_PER_SEC : TEXT_CHARS_PER_SEC,
          dtMs,
          TEXT_MAX_CHARS_PER_FRAME,
          !sawFinalMessage
        );
        setStreamingText(displayedText);
        if (displayedText.length < accumulatedText.length) needAnotherFrame = true;
      }

      // Thinking channel pacing — same idea, separate budget.
      if (displayedThinking.length < accumulatedThinking.length) {
        displayedThinking = advance(
          displayedThinking,
          accumulatedThinking,
          THINKING_CHARS_PER_SEC,
          dtMs,
          THINKING_MAX_CHARS_PER_FRAME,
          true
        );
        setThinkingText(displayedThinking);
        if (displayedThinking.length < accumulatedThinking.length) needAnotherFrame = true;
      }

      if (needAnotherFrame) {
        pacingRafId = window.requestAnimationFrame(tick);
      }
    };
    const schedulePacing = () => {
      if (pacingRafId === null) {
        pacingRafId = window.requestAnimationFrame(tick);
      }
    };
    // Force-flush both channels to their full buffers — used when the server
    // sends authoritative content (final_message) or terminates the stream.
    const flushImmediate = () => {
      if (pacingRafId !== null) {
        window.cancelAnimationFrame(pacingRafId);
        pacingRafId = null;
      }
      lastPaceTs = 0;
      displayedText = accumulatedText;
      displayedThinking = accumulatedThinking;
      setStreamingText(displayedText);
      setThinkingText(displayedThinking);
    };
    const cancelPendingFlushes = () => {
      if (pacingRafId !== null) {
        window.cancelAnimationFrame(pacingRafId);
        pacingRafId = null;
      }
      if (commitPollId !== null) {
        window.clearInterval(commitPollId);
        commitPollId = null;
      }
      lastPaceTs = 0;
    };

    const unsubscribe = subscribeToStream(
      sessionId,
      (event: SSEEvent) => {
        switch (event.type) {
          case "thinking_delta":
            accumulatedThinking += event.delta;
            schedulePacing();
            break;
          case "thinking_clear":
            // Backend signals the thinking phase is over and the final answer
            // is about to stream as text_delta chunks. Don't clear thinkingText
            // yet — keep it visible in the panel until the first text_delta
            // arrives so there's no blank-flash between "Thinking…" ending and
            // the answer text starting.
            accumulatedThinking = "";
            displayedThinking = "";
            // (setThinkingText deferred to first text_delta below)
            break;
          case "text_delta":
            // Answer streaming in real time from the backend. Clear the
            // thinking panel on the first chunk so the transition is seamless:
            // thinking disappears the moment answer text appears, not before.
            if (!accumulatedText) {
              accumulatedThinking = "";
              displayedThinking = "";
              setThinkingText("");
            }
            accumulatedText += event.delta;
            schedulePacing();
            break;
          case "final_message":
            // Authoritative content from server. Update the buffer but keep
            // pacing — flushing immediately would defeat the typing animation
            // for short responses where final_message arrives before pacing
            // has caught up. The pacing loop's catch-up branch handles the
            // tail. run_complete (below) is the hard flush point.
            sawFinalMessage = true;
            accumulatedText = event.content;
            // If the authoritative content is shorter than what's already on
            // screen, trim the displayed prefix to its longest agreement with
            // the new buffer instead of snapping all the way back. Avoids the
            // jarring "text deletes itself" effect when the server emits a
            // corrected/trimmed final message.
            if (displayedText.length > accumulatedText.length) {
              let agree = 0;
              const maxAgree = Math.min(displayedText.length, accumulatedText.length);
              while (agree < maxAgree && displayedText[agree] === accumulatedText[agree]) {
                agree += 1;
              }
              displayedText = accumulatedText.slice(0, agree);
              setStreamingText(displayedText);
            }
            schedulePacing();
            // Now that the recap text is set, open the canvas for any artifact
            // that arrived earlier this turn (artifact_written fires before finalize).
            if (pendingPreviewArtifactId) {
              const artifactId = pendingPreviewArtifactId;
              pendingPreviewArtifactId = null;
              // Delay the canvas open until after the typewriter has had time
              // to reveal the recap, so the text streams first and the preview
              // slides in behind it rather than stealing focus mid-animation.
              window.setTimeout(() => {
                api.getSession(sessionId).then((d) => {
                  setArtifacts(d.artifacts);
                  const newest = d.artifacts.find((a) => a.id === artifactId);
                  if (newest) setPreviewArtifact(newest);
                }).catch(() => {});
              }, 1200);
            }
            break;
          case "agent_spawned":
            setTraceEntries((p) => [...p, { id: uid(), type: "agent_spawned", timestamp: Date.now(), agent_id: event.agent_id, role: event.role }]);
            break;
          case "tool_use":
            setTraceEntries((p) => [...p, { id: uid(), type: "tool_use", timestamp: Date.now(), agent_id: event.agent_id, tool: event.tool, input: event.input }]);
            break;
          case "artifact_written":
            runArtifactIds.push(event.artifact_id);
            // Expose the in-flight artifact IDs to ChatPane so the "Generated
            // files" button can render inside the streaming bubble, not only
            // after run_complete commits the assistant message. Use a fresh
            // copy each time so React reliably re-renders.
            setRunArtifactIds(runArtifactIds.slice());
            // Buffer the artifact ID — canvas preview is deferred until
            // final_message fires so the recap text appears first.
            pendingPreviewArtifactId = event.artifact_id;
            setTraceEntries((p) => [...p, { id: uid(), type: "artifact_written", timestamp: Date.now(), artifact_id: event.artifact_id, artifact_name: event.name }]);
            // Refresh the artifact list so the header / sidebar counts stay
            // in sync, but defer auto-opening the preview until the recap
            // has streamed (handled in final_message).
            api.getSession(sessionId).then((d) => setArtifacts(d.artifacts)).catch(() => {});
            break;
          case "agent_done":
            setTraceEntries((p) => [...p, { id: uid(), type: "agent_done", timestamp: Date.now(), agent_id: event.agent_id, summary: event.summary }]);
            break;
          case "context_usage":
            setLiveContextPercent(event.percent);
            break;
          case "compaction_done":
            setTraceEntries((p) => [...p, { id: uid(), type: "compaction_done", timestamp: Date.now(), before_tokens: event.before_tokens, after_tokens: event.after_tokens }]);
            break;
          case "run_complete": {
            // Pacing may still be revealing the tail of accumulatedText when
            // run_complete arrives. Defer the streaming→persisted swap until
            // the displayed prefix has caught up so the user sees the typing
            // animation finish naturally instead of the bubble snapping. We
            // bound the wait via setInterval+timeout so a stuck pacing loop
            // can't keep the UI in "streaming" forever.
            commitStarted = true;
            const commit = () => {
              flushImmediate();
              api.getSession(sessionId).then((d) => {
                setSession(d.session);
                setArtifacts(d.artifacts);
                setMessages((prev) =>
                  mergeWithBanners(prev, d.messages.map(mapServerMessage))
                );
                accumulatedText = "";
                accumulatedThinking = "";
                displayedText = "";
                displayedThinking = "";
                runArtifactIds.length = 0;
                setRunArtifactIds([]);
                setStreamingText("");
                setThinkingText("");
                setIsStreaming(false);
              }).catch(() => {
                accumulatedText = "";
                accumulatedThinking = "";
                displayedText = "";
                displayedThinking = "";
                runArtifactIds.length = 0;
                setRunArtifactIds([]);
                setStreamingText("");
                setThinkingText("");
                setIsStreaming(false);
              });
            };

            // Wait for pacing to finish before swapping streaming → persisted.
            // Timeout is dynamic so long answers don't snap mid-animation.
            const pacingDone = () =>
              displayedText.length >= accumulatedText.length &&
              displayedThinking.length >= accumulatedThinking.length;
            if (pacingDone()) {
              commit();
            } else {
              schedulePacing();
              const remainingText = Math.max(0, accumulatedText.length - displayedText.length);
              const remainingThinking = Math.max(0, accumulatedThinking.length - displayedThinking.length);
              const projectedMs = Math.max(
                (remainingText / FINAL_TEXT_CHARS_PER_SEC) * 1000,
                (remainingThinking / THINKING_CHARS_PER_SEC) * 1000
              );
              const timeoutMs = Math.min(120000, Math.max(4000, projectedMs + 3000));
              const start = Date.now();
              commitPollId = window.setInterval(() => {
                if (pacingDone() || Date.now() - start > timeoutMs) {
                  if (commitPollId !== null) {
                    window.clearInterval(commitPollId);
                    commitPollId = null;
                  }
                  commit();
                }
              }, 80);
            }
            break;
          }
          case "error":
            cancelPendingFlushes();
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "system",
                systemKind: "error",
                content: event.message,
                errorTechnical: event.technical,
                errorCode: event.code,
                errorStatus: event.status ?? null,
              },
            ]);
            accumulatedText = "";
            accumulatedThinking = "";
            displayedText = "";
            displayedThinking = "";
            setStreamingText("");
            setThinkingText("");
            setRunArtifactIds([]);
            setIsStreaming(false);
            break;
        }
      },
      () => {
        // Stream closed without run_complete (e.g. network blip) — refetch.
        // If run_complete already kicked off the commit path, skip the refetch:
        // commit() does its own getSession and overwriting fresh state with a
        // second concurrent fetch can clobber it (race on reconnect).
        cancelPendingFlushes();
        if (commitStarted) return;
        api.getSession(sessionId).then((d) => {
          setSession(d.session);
          setArtifacts(d.artifacts);
          setMessages((prev) =>
            mergeWithBanners(prev, d.messages.map(mapServerMessage))
          );
        }).catch(() => {});
        setStreamingText("");
        setThinkingText("");
        setRunArtifactIds([]);
        setIsStreaming(false);
      }
    );

    stopRef.current = () => {
      cancelled = true;
      cancelPendingFlushes();
      unsubscribe();
    };
  }, [sessionId]);

  // Load session on mount.
  useEffect(() => {
    // Session route changed (or first mount): allow one server-audience hydrate
    // for this session id.
    if (didHydrateAudienceForSession.current !== sessionId) {
      didHydrateAudienceForSession.current = null;
    }
    api.getSession(sessionId).then((detail) => {
      setSession(detail.session);
      if (
        detail.session.audience &&
        didHydrateAudienceForSession.current !== sessionId
      ) {
        setAudience(detail.session.audience);
        didHydrateAudienceForSession.current = sessionId;
      }
      setMessages((prev) =>
        mergeWithBanners(prev, detail.messages.map(mapServerMessage))
      );
      setDocuments(detail.documents);
      setArtifacts(detail.artifacts);
      // Load persisted trace so history survives reloads & chat switching.
      api.getTrace(sessionId)
        .then((t) => setTraceEntries(t.events.map(persistedToTrace)))
        .catch(() => {});
      // Seed the context meter from persisted tokens so it's never stuck at 0.
      api.getContext(sessionId).then((u) => setLiveContextPercent(u.percent)).catch(() => {});

      // Handoff from /home: URL carries ?prompt=<text>&audience=<a>.
      const promptParam = searchParams?.get("prompt");
      const audParam = searchParams?.get("audience") as Audience | null;
      if (!didAttachInitial.current && promptParam) {
        didAttachInitial.current = true;
        // Explicit URL param takes priority; otherwise infer from the prompt
        // text; otherwise fall back to the session's persisted audience.
        const currentAudience = audienceRef.current;
        const inferred = !audParam ? inferAudience(promptParam) : null;
        const chosenAud = audParam || inferred || currentAudience;
        if (audParam) setAudience(audParam);
        else if (inferred && inferred !== currentAudience) {
          setAudience(inferred);
          api.updateSession(sessionId, { audience: inferred }).catch(() => {});
        }
        router.replace(`/sessions/${sessionId}`);
        const handoffAttachedIds = detail.documents.map((d) => d.id);
        setMessages((prev) => [...prev, { id: uid(), role: "user", content: promptParam, attachedDocs: detail.documents.map((d) => d.filename) }]);
        setIsStreaming(true);
        api.sendMessage(sessionId, promptParam, chosenAud, handoffAttachedIds)
          .then(() => {
            // Open SSE only after the backend marks this run "running" so we
            // don't subscribe to a terminal-state stream and miss real events.
            attachStream();
            return api.getSession(sessionId).then((d) => {
              setSession(d.session);
              window.dispatchEvent(new CustomEvent("sessions-changed"));
            }).catch(() => {});
          })
          .catch(() => {
            setIsStreaming(false);
            stopRef.current?.();
          });
      } else if (
        !didAttachInitial.current &&
        detail.session.last_run_state === "running"
      ) {
        // No handoff prompt, but the backend says a run is still in flight on
        // this session — most likely the user navigated away from this session
        // mid-stream and just came back. Re-subscribe to the SSE bus so the
        // remaining events (including `final_message` / `run_complete`) drive
        // the UI to its terminal state. Persisted trace already filled in any
        // events that fired while we were unmounted.
        didAttachInitial.current = true;
        attachStream();
      }
    }).catch(() => router.push("/home"));

    // Cleanup: when the user navigates away (different session, /home, etc.),
    // close the EventSource so we don't leak connections. The backend run
    // itself keeps running — the next mount will detect last_run_state and
    // re-attach.
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
    // `audience` intentionally omitted — it's read via audienceRef so manual
    // toggles don't trigger an extra getSession refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, router, searchParams, attachStream]);

  const handleSend = useCallback(async (text: string, attachedDocs: string[] = []) => {
    if (isStreaming) return;

    // Use the current audience toggle value. Auto-inference via inferAudience()
    // was silently flipping the toggle to "professional" when messages contained
    // domain phrasing, which contradicted the user's explicit layperson/expert
    // selection. The toggle is the sole source of truth.
    const resolvedAudience = audience;

    setIsStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", content: text, attachedDocs },
    ]);

    try {
      // Send the message first so the backend sets last_run_state = "running"
      // before the SSE EventSource connects. Opening attachStream() before
      // sendMessage reaches the server causes the SSE endpoint to see a
      // terminal last_run_state (e.g. "completed") and return a fake
      // run_complete immediately — the real run then publishes into an
      // unsubscribed bus and the UI appears stuck until the browser is refreshed.
      await api.sendMessage(
        sessionId,
        text,
        resolvedAudience,
        documents.map((d) => d.id)
      );
      // Now that the backend has the run in flight, open the SSE stream.
      attachStream();
      // Refresh session so the auto-generated title shows up in both the
      // header and the sidebar without requiring a page reload.
      api.getSession(sessionId).then((d) => {
        setSession(d.session);
        window.dispatchEvent(new CustomEvent("sessions-changed"));
      }).catch(() => {});
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [sessionId, audience, isStreaming, attachStream, documents]);

  function handleStop() {
    // Tell the backend to stop the agentic loop at its next iteration so
    // we don't keep burning tokens after the user clicks Stop. The SSE
    // close below is local-only — it does not interrupt the backend run.
    api.cancelRun(sessionId).catch(() => {});
    stopRef.current?.();
    stopRef.current = null;
    setIsStreaming(false);
    if (streamingText) {
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: streamingText + " [stopped]" }]);
      setStreamingText("");
    }
    setThinkingText("");
    setRunArtifactIds([]);
  }

  async function handleCompact() {
    setCompacting(true);
    await api.compact(sessionId).catch(() => {});
    setCompacting(false);
  }

  async function commitTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === (session?.title || "")) return;
    setSession((prev) => (prev ? { ...prev, title: next } : prev));
    try {
      await api.updateSession(sessionId, { title: next });
    } catch {
      // ignore; UI rolls back via next refresh
    }
  }

  const handleRetry = useCallback(async (assistantMessageId: string) => {
    if (isStreaming) return;
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx < 1) return;
    const userMsg = messages[idx - 1];
    if (userMsg.role !== "user") return;

    try {
      await api.truncateAfter(sessionId, assistantMessageId);
    } catch {}
    setMessages((prev) => prev.filter((_, i) => i < idx));
    setIsStreaming(true);
    try {
      // Re-send with the same doc set the user had at retry time — keeps the
      // re-rendered user bubble's chips consistent with what the agent saw.
      await api.sendMessage(
        sessionId,
        userMsg.content,
        audience,
        documents.map((d) => d.id)
      );
      // Subscribe only after the backend run is definitely live.
      attachStream();
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream, documents]);

  const handleEdit = useCallback(async (userMessageId: string, newContent: string) => {
    if (isStreaming) return;
    try {
      await api.truncateAfter(sessionId, userMessageId);
    } catch {}
    const idx = messages.findIndex((m) => m.id === userMessageId);
    setMessages((prev) => {
      const kept = idx >= 0 ? prev.slice(0, idx) : prev;
      return [...kept, { id: uid(), role: "user", content: newContent, attachedDocs: prev[idx]?.attachedDocs }];
    });
    setIsStreaming(true);
    try {
      await api.sendMessage(
        sessionId,
        newContent,
        audience,
        documents.map((d) => d.id)
      );
      // Subscribe only after the backend run is definitely live.
      attachStream();
    } catch {
      setIsStreaming(false);
      stopRef.current?.();
    }
  }, [messages, sessionId, audience, isStreaming, attachStream, documents]);

  const previewOpen = !!previewArtifact;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0b10]">
      <ChatSidebar activeSessionId={sessionId} />

      {/* Main column — shrinks when the artifact preview is open. */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header: AudienceToggle centred, title editable */}
        <header className="h-14 shrink-0 flex items-center px-4 border-b border-[#2d3148] bg-[#0f1117] relative">
          <div className="flex items-center gap-2 min-w-0 max-w-xs">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                  else if (e.key === "Escape") { setEditingTitle(false); }
                }}
                className="flex-1 min-w-0 bg-[#0f1117] border border-[#2d3148] rounded px-2 py-0.5 text-sm text-slate-100 outline-none focus:border-blue-500/50"
              />
            ) : (
              <>
                <span className="text-sm text-slate-400 truncate" title={session?.title || "Constellation Session"}>
                  {session?.title || "Constellation Session"}
                </span>
                <button
                  onClick={() => { setTitleDraft(session?.title || ""); setEditingTitle(true); }}
                  title="Rename chat"
                  className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27] transition shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {editingTitle && (
              <button
                onMouseDown={(e) => { e.preventDefault(); commitTitle(); }}
                title="Save"
                className="p-1 rounded text-emerald-400 hover:bg-[#1a1d27] transition"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2">
            <AudienceToggle
              value={audience}
              onChange={(next) => {
                if (next === audience) return;
                setAudience(next);
                // Drop a transient banner in the chat so the user has a clear
                // visual marker of when the toggle took effect.
                setMessages((prev) => [
                  ...prev,
                  {
                    id: uid(),
                    role: "system",
                    systemKind: "audience_change",
                    content: `switched to ${next} mode`,
                  },
                ]);
                // Persist the user's choice so refresh / session switching keeps it.
                api.updateSession(sessionId, { audience: next }).catch(() => {});
              }}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SessionFiles
              documents={documents}
              artifacts={artifacts}
              onUploadClick={() => setUploadOpen(true)}
              onArtifactClick={setPreviewArtifact}
              onDocumentDelete={async (d) => {
                if (!window.confirm(`Remove "${d.filename}" from this chat?`)) return;
                try {
                  await api.deleteDocument(sessionId, d.id);
                  setDocuments((prev) => prev.filter((x) => x.id !== d.id));
                  // Citation labels in older messages cache the deleted
                  // document's filename — clear them so subsequent renders
                  // re-fetch (and surface as "not found") instead of
                  // showing a stale label.
                  clearCitationCache();
                } catch (err) {
                  // Surface the server's reason (most often: doc is referenced
                  // by a previous message) so the user knows why it failed.
                  const msg =
                    err instanceof Error ? err.message : "Failed to delete document.";
                  window.alert(msg);
                }
              }}
            />
          </div>
        </header>

        {/* Main chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatPane
            sessionId={sessionId}
            messages={messages}
            streamingText={streamingText}
            thinkingText={thinkingText}
            streamingArtifactIds={runArtifactIds}
            artifacts={artifacts}
            documents={documents}
            isStreaming={isStreaming}
            onSend={handleSend}
            onStop={handleStop}
            onCitationClick={(id) => setDrawerChunkId(id)}
            onUploadClick={() => setUploadOpen(true)}
            onArtifactPreview={setPreviewArtifact}
            onRetry={handleRetry}
            onEdit={handleEdit}
            onDropFile={async (files) => {
              for (const file of Array.from(files)) {
                try {
                  const doc = await api.uploadDocument(sessionId, file);
                  setDocuments((prev) => [...prev, doc]);
                } catch {
                  // Upload failures surface via the next session refresh.
                }
              }
            }}
            liveContextPercent={liveContextPercent}
            onCompact={handleCompact}
            compacting={compacting}
            traceEntries={traceEntries}
          />
        </main>
      </div>

      {/* Artifact preview — lives in the flex row so it shrinks the chat column
          instead of overlapping it. */}
      {previewOpen && (
        <ArtifactPreview
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
          onCitationClick={(id) => setDrawerChunkId(id)}
        />
      )}

      {/* Source drawer for citations (still overlay) */}
      <SourceDrawer chunkId={drawerChunkId} onClose={() => setDrawerChunkId(null)} />

      {/* Upload modal */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60"
          onClick={() => setUploadOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#13151f] border border-[#2d3148] rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <UploadIcon className="w-4 h-4 text-blue-400" />
                Upload files
              </div>
              <button
                onClick={() => setUploadOpen(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1a1d27]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <UploadZone
                sessionId={sessionId}
                onUploaded={(doc) => {
                  setDocuments((prev) => [...prev, doc]);
                  // Debounce close: reset the timer on each file so the modal
                  // stays open until all uploads in a multi-file batch finish.
                  if (uploadCloseTimerRef.current) clearTimeout(uploadCloseTimerRef.current);
                  uploadCloseTimerRef.current = setTimeout(() => setUploadOpen(false), 800);
                }}
              />
              {documents.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                    In this chat
                  </p>
                  <ul className="space-y-1">
                    {documents.map((d) => (
                      <li key={d.id} className="flex items-start gap-1.5 text-xs text-slate-400 truncate">
                        <span className="text-slate-600 shrink-0">•</span>
                        <span className="truncate" title={d.filename}>{d.filename}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

