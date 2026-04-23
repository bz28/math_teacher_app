"use client";

import { useRef, useState } from "react";

/**
 * Shown after a low-confidence Vision pass on a submission that
 * still has retake budget (attempts_remaining > 0). The student
 * picks a new photo and we POST /retake, which re-runs extraction.
 *
 * We don't auto-retake on transient errors — blurry handwriting and
 * a 500 from the Vision API are indistinguishable from here, and the
 * student is the only one who can improve the photo.
 */
export function ExtractionRetakeView({
  attemptsRemaining,
  onRetake,
  submitting,
  error,
}: {
  attemptsRemaining: number;
  onRetake: (imageBase64: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setPickedName(null);
      setPickedBase64(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLocalError("Photo is too large (max 5 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPickedName(file.name);
      setPickedBase64(typeof reader.result === "string" ? reader.result : null);
    };
    reader.onerror = () => setLocalError("Couldn't read that file. Try another.");
    reader.readAsDataURL(file);
  }

  function handleRetake() {
    if (!pickedBase64) return;
    onRetake(pickedBase64);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-center">
      <div className="mx-auto mb-4 text-4xl" aria-hidden>
        📸
      </div>
      <h1 className="text-2xl font-bold text-text-primary">
        We couldn&rsquo;t read that clearly
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Your handwriting was too blurry to extract cleanly. Try a clearer
        photo — good lighting, steady hand, fills the frame.
      </p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        {attemptsRemaining} {attemptsRemaining === 1 ? "try" : "tries"} remaining
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={onFileChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-6 rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:border-primary/40"
      >
        {pickedName ? `Replace: ${pickedName}` : "Choose new photo"}
      </button>

      {(localError || error) && (
        <p className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">
          {localError || error}
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={handleRetake}
          disabled={!pickedBase64 || submitting}
          className="rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Uploading…" : "Try again"}
        </button>
      </div>
    </div>
  );
}

/** Terminal state — three Vision attempts all failed. No grade will
 *  run; the teacher handles it from the inbox. */
export function ExtractionUnreadableFinalView() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-center">
      <div className="mx-auto mb-4 text-4xl" aria-hidden>
        ✉️
      </div>
      <h1 className="text-2xl font-bold text-text-primary">
        We&rsquo;ve sent your homework to your teacher
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        We couldn&rsquo;t read your handwriting after a few tries, so
        we&rsquo;ve flagged your submission for your teacher to grade
        directly. They can see the photo you uploaded.
      </p>
      <p className="mt-4 text-xs text-text-muted">
        Nothing else to do — your teacher will follow up if they need
        anything from you.
      </p>
    </div>
  );
}
