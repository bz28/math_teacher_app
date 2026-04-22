"use client";

import { useRef } from "react";
import { fileToBase64 } from "@/lib/utils";

interface AttachWorkProps {
  attached: boolean;
  onAttach: (base64: string) => void;
  isPro?: boolean;
  onUpgradeNeeded?: () => void;
}

export function AttachWork({ attached, onAttach, isPro = true, onUpgradeNeeded }: AttachWorkProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    onAttach(await fileToBase64(file));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!isPro) { onUpgradeNeeded?.(); return; }
          fileRef.current?.click();
        }}
        className={`flex w-full items-center gap-2 rounded-[--radius-md] border px-4 py-3 text-sm font-medium transition-colors ${
          attached
            ? "border-success bg-success-light text-success"
            : !isPro
              ? "border-dashed border-border text-text-muted opacity-70"
              : "border-dashed border-border text-text-secondary hover:border-primary hover:text-primary"
        }`}
      >
        {attached ? (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Work attached
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            {!isPro ? "Attach your work (Pro)" : "Attach your work"}
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
        className="hidden"
      />
    </>
  );
}
