"use client";

import { useEffect, useState } from "react";

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

async function fetchMeta(id: string): Promise<ChunkMeta> {
  if (_cache.has(id)) return _cache.get(id) ?? null;
  const existing = _inFlight.get(id);
  if (existing) return existing;
  const p = fetch(`/api/chunks/${id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: ChunkMeta) => {
      _cache.set(id, data);
      return data;
    })
    .catch(() => null)
    .finally(() => _inFlight.delete(id));
  _inFlight.set(id, p);
  return p;
}

function shortenFilename(name: string, max = 24): string {
  // Drop extension, collapse whitespace, trim to max with ellipsis.
  const base = name.replace(/\.[^.]+$/, "").trim();
  if (base.length <= max) return base;
  return base.slice(0, max - 1).trimEnd() + "…";
}

const LOADING = Symbol("loading");

export default function CitationLink({ chunkId, onClick }: Props) {
  const cached = _cache.has(chunkId) ? (_cache.get(chunkId) ?? null) : LOADING;
  const [meta, setMeta] = useState<ChunkMeta | typeof LOADING>(cached);

  useEffect(() => {
    if (_cache.has(chunkId)) {
      setMeta(_cache.get(chunkId) ?? null);
      return;
    }
    setMeta(LOADING);
    fetchMeta(chunkId).then((m) => setMeta(m));
  }, [chunkId]);

  // Prefer: "filename p.N", "filename §id", "filename", "p.N", "§id".
  let label: string;
  if (meta === LOADING) {
    label = "…";
  } else {
    const fname = meta?.filename ? shortenFilename(meta.filename) : null;
    if (fname && meta?.page) label = `${fname} p.${meta.page}`;
    else if (fname && meta?.section_id) label = `${fname} §${meta.section_id}`;
    else if (fname) label = fname;
    else if (meta?.page) label = `p.${meta.page}`;
    else if (meta?.section_id) label = `§${meta.section_id}`;
    else label = chunkId.slice(0, 6);
  }

  return (
    <button
      onClick={() => onClick(chunkId)}
      className="citation-link mx-0.5"
      title={
        meta?.filename
          ? `View source — ${meta.filename}${meta.page ? ` (p.${meta.page})` : ""}`
          : `View source — chunk ${chunkId.slice(0, 8)}`
      }
    >
      [{label}]
    </button>
  );
}
