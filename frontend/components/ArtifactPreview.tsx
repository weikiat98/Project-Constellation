"use client";

import { X, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact } from "@/lib/api";
import { CITATION_RE, UUID_RE, downloadArtifact } from "@/lib/citations";
import CitationLink from "./CitationLink";

function injectCitations(nodes: React.ReactNode, onCitation: (id: string) => void): React.ReactNode {
  const replaceInString = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    CITATION_RE.lastIndex = 0;
    while ((match = CITATION_RE.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const ids = match[1].match(UUID_RE) ?? [];
      ids.forEach((id, i) => {
        parts.push(<CitationLink key={`${keyPrefix}-${match!.index}-${i}`} chunkId={id} onClick={onCitation} />);
      });
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
  if (typeof nodes === "string") return replaceInString(nodes, "s");
  if (Array.isArray(nodes)) return nodes.flatMap((n, i) => typeof n === "string" ? replaceInString(n, `a${i}`) : [n]);
  return nodes;
}

interface Props {
  artifact: Artifact | null;
  onClose: () => void;
  onCitationClick?: (chunkId: string) => void;
}

function parseCsv(text: string): string[][] {
  // Lightweight CSV parser — handles double-quoted cells and embedded commas.
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* ignore */ }
      else cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}


export default function ArtifactPreview({ artifact, onClose, onCitationClick }: Props) {
  if (!artifact) return null;
  const handleCitation = onCitationClick ?? (() => {});

  const mime = artifact.mime_type;

  // Side canvas: lives as a sibling flex column so opening it shrinks the chat
  // column instead of overlapping it.
  return (
    <aside className="shrink-0 w-full sm:w-[560px] lg:w-[640px] max-w-[50vw] h-full bg-[#13151f] border-l border-[#2d3148] flex flex-col shadow-2xl animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d3148]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-200 truncate">{artifact.name}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">
            {mime === "text/html" ? "HTML" : mime === "text/csv" ? "CSV" : "MD"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => downloadArtifact(artifact)}
            title="Download"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1a1d27] transition"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1a1d27] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {mime === "text/html" ? (
          <iframe
            srcDoc={artifact.content}
            sandbox=""
            className="w-full h-full bg-white"
            title={artifact.name}
          />
        ) : mime === "text/csv" ? (
          <CsvTable text={artifact.content} />
        ) : (
          <div className="prose prose-sm prose-invert max-w-none p-6">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p>{injectCitations(children, handleCitation)}</p>,
                li: ({ children }) => <li>{injectCitations(children, handleCitation)}</li>,
                h1: ({ children }) => <h1>{injectCitations(children, handleCitation)}</h1>,
                h2: ({ children }) => <h2>{injectCitations(children, handleCitation)}</h2>,
                h3: ({ children }) => <h3>{injectCitations(children, handleCitation)}</h3>,
              }}
            >
              {artifact.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </aside>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return <p className="p-6 text-slate-500 text-sm">Empty CSV.</p>;
  const [header, ...body] = rows;
  return (
    <div className="p-4 overflow-auto">
      <table className="text-xs text-slate-200 border-collapse">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold border border-[#2d3148] bg-[#1a1d27]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-[#0f1117]" : "bg-[#13151f]"}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 border border-[#2d3148] whitespace-pre-wrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
