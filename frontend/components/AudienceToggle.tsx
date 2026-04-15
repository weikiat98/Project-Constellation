"use client";

import type { Audience } from "@/lib/api";

interface Props {
  value: Audience;
  onChange: (a: Audience) => void;
}

const options: { value: Audience; label: string; desc: string }[] = [
  { value: "layperson", label: "Layperson", desc: "Plain language" },
  { value: "professional", label: "Professional", desc: "Domain terms" },
  { value: "expert", label: "Expert", desc: "Precise legal/technical" },
];

export default function AudienceToggle({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 bg-[#1a1d27] rounded-lg p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.desc}
          className={`px-3 py-1 rounded text-xs font-medium transition ${
            value === opt.value
              ? "bg-blue-600 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
