// Shared citation utilities. Used by both inline artifact cards and the
// artifact preview canvas so the downloaded file always has human-readable
// labels (filename + page) rather than raw chunk UUIDs.

import type { Artifact } from "./api";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// Any [...] span that contains at least one UUID. This intentionally accepts
// variants like `[chunk: <uuid>]` or `[source=<uuid>; ...]`, not only `[uuid]`.
export const CITATION_RE = new RegExp(`\\[(?=[^\\]\\n]*${UUID})[^\\]\\n]*\\]`, "gi");
export const UUID_RE = new RegExp(UUID, "gi");

type ChunkMeta = { page?: number | null; section_id?: string | null; filename?: string | null } | null;

export function normalizeChunkId(id: string): string {
  return id.trim().toLowerCase();
}

export function extractCitationIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  UUID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UUID_RE.exec(text)) !== null) {
    const normalized = normalizeChunkId(m[0]);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      ids.push(normalized);
    }
  }
  return ids;
}

function shortenFilename(name: string, max = 40): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  if (base.length <= max) return base;
  return base.slice(0, max - 1).trimEnd() + "\u2026";
}

function labelFor(meta: ChunkMeta, fallbackId: string): string {
  if (!meta) return `source ${fallbackId.slice(0, 4)}`;
  const fname = meta.filename ? shortenFilename(meta.filename) : null;
  if (fname && typeof meta.page === "number") return `${fname} p.${meta.page}`;
  if (fname && meta.section_id) return `${fname} \u00A7${meta.section_id}`;
  if (fname) return fname;
  if (typeof meta.page === "number") return `p.${meta.page}`;
  if (meta.section_id) return `\u00A7${meta.section_id}`;
  return `source ${fallbackId.slice(0, 4)}`;
}

export async function resolveCitations(text: string): Promise<string> {
  const ids = Array.from(new Set(extractCitationIds(text)));
  if (ids.length === 0) return text;

  const metas = new Map<string, ChunkMeta>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`/api/chunks/${normalizeChunkId(id)}`);
        metas.set(id, r.ok ? await r.json() : null);
      } catch {
        metas.set(id, null);
      }
    })
  );

  return text.replace(CITATION_RE, (full) => {
    const inner = extractCitationIds(full)
      .map((normalized) => labelFor(metas.get(normalized) ?? null, normalized))
      .join(", ");
    if (!inner) return full;
    return `[${inner}]`;
  });
}

export async function downloadArtifact(a: Artifact) {
  const ext =
    a.mime_type === "text/html" ? "html" :
    a.mime_type === "text/csv" ? "csv" :
    a.mime_type === "text/plain" ? "txt" : "md";
  // CSV is raw content; all other formats (plain text, markdown, html) can
  // contain [chunk_id] citations that should be resolved before download.
  const content = a.mime_type === "text/csv" ? a.content : await resolveCitations(a.content);
  const blob = new Blob([content], { type: a.mime_type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${a.name}.${ext}`;
  link.click();
  URL.revokeObjectURL(url);
}
