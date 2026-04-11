"use client";

import { useRef } from "react";
import { CameraIcon, CheckIcon } from "./icons";

interface AttachWorkProps {
  attached: boolean;
  onAttach: (base64: string) => void;
  isPro?: boolean;
  onUpgradeNeeded?: () => void;
}

export function AttachWork({ attached, onAttach, isPro = true, onUpgradeNeeded }: AttachWorkProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      onAttach(base64);
    };
    reader.readAsDataURL(file);
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
            <CheckIcon className="h-4 w-4" />
            Work attached
          </>
        ) : (
          <>
            <CameraIcon className="h-4 w-4" />
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
