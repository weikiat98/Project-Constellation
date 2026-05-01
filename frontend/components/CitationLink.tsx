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
      _cache.set(normalized, data);
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

  useEffect(() => {
    if (_cache.has(normalizedChunkId)) {
      setMeta(_cache.get(normalizedChunkId) ?? null);
      return;
    }
    setMeta(LOADING);
    fetchMeta(normalizedChunkId).then((m) => setMeta(m));
  }, [normalizedChunkId]);

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
