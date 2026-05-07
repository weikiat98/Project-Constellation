"use client";

import { useEffect, useState } from "react";
import { normalizeChunkId } from "@/lib/citations";

interface Props {
  chunkId: string;
  onClick: (chunkId: string) => void;
}

// Tiny in-memory cache shared across all CitationLink instances so we don't
// re-hit /api/chunks/{id} for the same chunk.
type ChunkMeta = {
  page?: number | null;
  section_id?: string | null;
  filename?: string | null;
} | null;
const _cache = new Map<string, ChunkMeta>();
const _inFlight = new Map<string, Promise<ChunkMeta>>();

/**
 * Drop all cached chunk metadata. Call this after deleting a document so
 * citations referencing the now-removed document re-fetch (and surface as
 * "not found") instead of showing the stale filename label.
 */
export function clearCitationCache(): void {
  _cache.clear();
  _inFlight.clear();
}

async function fetchMeta(id: string): Promise<ChunkMeta> {
  const normalized = normalizeChunkId(id);
  if (_cache.has(normalized)) return _cache.get(normalized) ?? null;
  const existing = _inFlight.get(normalized);
  if (existing) return existing;
  const p = fetch(`/api/chunks/${normalized}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: ChunkMeta) => {
      // Only cache successful lookups. A null result during streaming means
      // the chunk wasn't committed yet — caching null would permanently show
      // the UUID fallback label instead of the document name and page number.
      if (data !== null) _cache.set(normalized, data);
      return data;
    })
    .catch(() => null)
    .finally(() => _inFlight.delete(normalized));
  _inFlight.set(normalized, p);
  return p;
}

function shortenFilename(name: string, max = 24): string {
  // Drop extension, collapse whitespace, trim to max with ellipsis.
  const base = name.replace(/\.[^.]+$/, "").trim();
  if (base.length <= max) return base;
  return base.slice(0, max - 1).trimEnd() + "\u2026";
}

const LOADING = Symbol("loading");

export default function CitationLink({ chunkId, onClick }: Props) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  const cached = _cache.has(normalizedChunkId)
    ? (_cache.get(normalizedChunkId) ?? null)
    : LOADING;
  const [meta, setMeta] = useState<ChunkMeta | typeof LOADING>(cached);
  // Retry counter: bumped when a fetch returns null so we re-attempt after a
  // short delay. Chunks may not be committed to the DB yet when citations first
  // render during streaming — a single retry after ~2s catches most cases.
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (_cache.has(normalizedChunkId)) {
      setMeta(_cache.get(normalizedChunkId) ?? null);
      return;
    }
    setMeta(LOADING);
    let retryTimer: ReturnType<typeof window.setTimeout> | null = null;
    fetchMeta(normalizedChunkId).then((m) => {
      setMeta(m);
      // Schedule one retry if the chunk wasn't found yet (e.g. still mid-stream).
      if (m === null && retryCount === 0) {
        retryTimer = window.setTimeout(() => setRetryCount(1), 2000);
      }
    });
    return () => { if (retryTimer !== null) window.clearTimeout(retryTimer); };
  // retryCount is intentionally included so a null result triggers one re-fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedChunkId, retryCount]);

  // Prefer: "filename p.N", "filename \u00A7id", "filename", "p.N", "\u00A7id".
  let label: string;
  if (meta === LOADING) {
    label = "source";
  } else {
    const fname = meta?.filename ? shortenFilename(meta.filename) : null;
    if (fname && typeof meta?.page === "number") label = `${fname} p.${meta.page}`;
    else if (fname && meta?.section_id) label = `${fname} \u00A7${meta.section_id}`;
    else if (fname) label = fname;
    else if (typeof meta?.page === "number") label = `p.${meta.page}`;
    else if (meta?.section_id) label = `\u00A7${meta.section_id}`;
    else label = `source ${normalizedChunkId.slice(0, 4)}`;
  }

  // Narrow away the LOADING symbol so tooltip access is type-safe.
  const resolvedMeta = meta === LOADING ? null : meta;
  const pageSuffix =
    typeof resolvedMeta?.page === "number" ? ` (p.${resolvedMeta.page})` : "";
  const title = resolvedMeta?.filename
    ? `View source \u2014 ${resolvedMeta.filename}${pageSuffix}`
    : "View source passage";

  return (
    <button
      onClick={() => onClick(normalizedChunkId)}
      className="citation-link mx-0.5"
      title={title}
    >
      [{label}]
    </button>
  );
}
