"use client";

interface Props {
  chunkId: string;
  onClick: (chunkId: string) => void;
}

export default function CitationLink({ chunkId, onClick }: Props) {
  const short = chunkId.slice(0, 8);
  return (
    <button
      onClick={() => onClick(chunkId)}
      className="citation-link mx-0.5"
      title={`View source: chunk ${chunkId}`}
    >
      [{short}]
    </button>
  );
}
