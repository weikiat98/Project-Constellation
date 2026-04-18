// Shared citation utilities. Used by both inline artifact cards and the
// artifact preview canvas so the downloaded file always has human-readable
// labels (filename + page) rather than raw chunk UUIDs.

import type { Artifact } from "./api";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const CITATION_RE = new RegExp(`\\[(${UUID}(?:\\s*[,;]\\s*${UUID})*)\\]`, "g");
export const UUID_RE = new RegExp(UUID, "g");

type ChunkMeta = { page?: number | null; section_id?: string | null; filename?: string | null } | null;

function shortenFilename(name: string, max = 40): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  if (base.length <= max) return base;
  return base.slice(0, max - 1).trimEnd() + "…";
}

function labelFor(meta: ChunkMeta, fallbackId: string): string {
  if (!meta) return fallbackId.slice(0, 6);
  const fname = meta.filename ? shortenFilename(meta.filename) : null;
  if (fname && meta.page) return `${fname} p.${meta.page}`;
  if (fname && meta.section_id) return `${fname} §${meta.section_id}`;
  if (fname) return fname;
  if (meta.page) return `p.${meta.page}`;
  if (meta.section_id) return `§${meta.section_id}`;
  return fallbackId.slice(0, 6);
}

export async function resolveCitations(text: string): Promise<string> {
  const ids = Array.from(new Set(text.match(UUID_RE) ?? []));
  if (ids.length === 0) return text;

  const metas = new Map<string, ChunkMeta>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`/api/chunks/${id}`);
        metas.set(id, r.ok ? await r.json() : null);
      } catch {
        metas.set(id, null);
      }
    })
  );

  return text.replace(CITATION_RE, (_full, group: string) => {
    const inner = (group.match(UUID_RE) ?? [])
      .map((id) => labelFor(metas.get(id) ?? null, id))
      .join(", ");
    return `[${inner}]`;
  });
}

export async function downloadArtifact(a: Artifact) {
  const ext =
    a.mime_type === "text/html" ? "html" :
    a.mime_type === "text/csv" ? "csv" : "md";
  const content = a.mime_type === "text/csv" ? a.content : await resolveCitations(a.content);
  const blob = new Blob([content], { type: a.mime_type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${a.name}.${ext}`;
  link.click();
  URL.revokeObjectURL(url);
}
