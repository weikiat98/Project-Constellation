import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Constellation",
  description: "Multi-agent document analysis for legal, policy, and academic texts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-[#0f1117] text-slate-200 antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
