"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SLIDES = [
  "/splash/constellation1.jpg",
  "/splash/galaxy1.jpg",
  "/splash/starrynight1.jpg",
  "/splash/constellation2.jpg",
  "/splash/galaxy2.jpg",
  "/splash/starrynight2.jpg",
];

const INTERVAL_MS = 6000;

export default function SplashPage() {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    SLIDES.forEach((src) => {
      // Use window.Image so this stays a DOM HTMLImageElement even if a
      // future edit adds `import Image from "next/image"` to this file.
      const img = new window.Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0a0b10]">
      {SLIDES.map((src, i) => (
        <div
          key={src}
          aria-hidden
          className="absolute inset-0 bg-center bg-cover transition-opacity duration-[2000ms] ease-in-out"
          style={{
            backgroundImage: `url(${src})`,
            opacity: i === index ? 1 : 0,
          }}
        />
      ))}

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80"
      />

      <div className="relative z-10 min-h-screen w-full flex items-center justify-center px-8">
        <div className="flex flex-col items-center text-center max-w-3xl">
          <div className="flex items-center justify-center mb-8">
            <h1 className="text-6xl font-bold text-slate-100 tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              Constellation
            </h1>
          </div>

          <p className="text-slate-200 text-xl leading-relaxed mb-14 max-w-2xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
            Multi-agentic analysis for technical documents ranging from legal, regulatory, research,
            Information Technology to Policies. Every claim is cited. Every answer is verifiable.
          </p>

          <button
            onClick={() => router.push("/home")}
            className="px-16 py-4 bg-white hover:bg-slate-200 text-slate-900 rounded-xl font-semibold text-2xl tracking-wide transition shadow-lg shadow-white/20"
          >
            START
          </button>
        </div>
      </div>
    </div>
  );
}
