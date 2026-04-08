"use client";

// Tiny inline indicator for auto-saved fields. Pure derivation of
// the visual from the prop — no internal state, no effects. The
// "saved" indicator persists until the parent moves the field back
// to "idle" or fires another save (which transitions to "saving").
// Earlier versions auto-faded "saved" after a couple seconds via
// useEffect+setTimeout, which violated react-hooks/set-state-in-effect
// and added complexity for negligible UX gain — a persistent ✓ Saved
// next to the field is honest about the last action.
//
// State machine:
//   idle → saving → saved → (next interaction) → saving → saved
//   idle → saving → error → (next interaction) → saving → saved/error
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
  if (state === "saved") {
    return (
      <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">
        ✓ Saved
      </span>
    );
  }
  return null;
}
