"use client";

import { useEffect, useState } from "react";

// Tiny inline indicator for auto-saved fields. Shows "saved" briefly
// after a successful PATCH and fades; shows error + Retry button on
// failure. Pairs with a parent that runs the actual save and tracks
// the per-field state.
//
// State machine:
//   idle → saving → saved (auto-fade) → idle
//   idle → saving → error → idle (after Retry)
export type SaveState = "idle" | "saving" | "saved" | "error";

export function InlineSavedHint({
  state,
  errorMessage,
  onRetry,
}: {
  state: SaveState;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  // Auto-fade the "saved" indicator after a couple seconds.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (state !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(t);
  }, [state]);

  if (state === "saving") {
    return (
      <span className="text-[10px] font-semibold text-text-muted">Saving…</span>
    );
  }
  if (state === "error") {
    return (
      <span className="text-[10px] font-semibold text-red-600">
        {errorMessage ?? "Save failed"}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        )}
      </span>
    );
  }
  if (state === "saved" && showSaved) {
    return (
      <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
        ✓ Saved
      </span>
    );
  }
  return null;
}
