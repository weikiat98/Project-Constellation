"use client";

import { useRouter } from "next/navigation";
import { BookOpen } from "lucide-react";

export default function SplashPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0b10] px-8">
      <div className="flex flex-col items-center text-center max-w-3xl">
        <div className="flex items-center justify-center gap-5 mb-8">
          <BookOpen className="w-16 h-16 text-blue-400" />
          <h1 className="text-6xl font-bold text-slate-100 tracking-tight">
            Deep-Reading Assistant
          </h1>
        </div>

        <p className="text-slate-400 text-xl leading-relaxed mb-14 max-w-2xl">
          Multi-agent analysis for legal acts, regulations, academic papers, and
          policy documents. Every claim is cited. Every answer is verifiable.
        </p>

        <button
          onClick={() => router.push("/home")}
          className="px-16 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-2xl tracking-wide transition shadow-lg shadow-blue-600/20"
        >
          START
        </button>
      </div>
    </div>
  );
}
