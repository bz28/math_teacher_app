"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { schoolStudent, type ExtractionStatusResponse, type SubmissionExtraction } from "@/lib/api";
import { ExtractionConfirmView } from "./extraction-confirm-view";
import {
  ExtractionRetakeView,
  ExtractionUnreadableFinalView,
} from "./extraction-retake-view";

/**
 * Post-submit extraction flow state machine. Owns polling + the four
 * screens (preparing / confirm / retake / unreadable-final) so the
 * parent page just mounts this while extraction is un-confirmed and
 * un-mounts once the student has confirmed (or hit the terminal
 * unreadable state, where grading won't run anyway).
 *
 * Polling runs whenever server-side extraction might be in flight:
 *   • Initial submit: status=pending, attempts=0 → poll until it moves.
 *   • After retake: we snapshot the attempts counter at click-time;
 *     poll until the server has completed a NEW pass (counter
 *     increments past the snapshot) or the status flips off `pending`.
 * Poll also covers the stuck-awaiting-retake-click case as a cheap
 * freshness check (2s DB read); that's a tiny write-protection margin
 * with no cost worth optimizing.
 *
 * After a max-poll budget is exhausted without any change, we surface
 * a generic "something went wrong" error so the student isn't stuck
 * on the preparing spinner forever if the background task crashed.
 */
const POLL_INTERVAL_MS = 2000;
// After ~90s of the initial/retake extraction never completing, bail
// out. Vision calls typically finish in 5–15s; 90s catches background
// crashes or DB-unreachable situations (the bg task exception handler
// logs-and-moves-on, leaving the submission in pending). One-shot —
// the student refreshes to retry from scratch.
const STUCK_POLL_BUDGET = 45; // 45 polls × 2s = 90s

export function ExtractionFlowContainer({
  submissionId,
  imageDataUrl,
  onConfirmed,
}: {
  submissionId: string;
  imageDataUrl: string | null;
  /** Called when the student confirms. Parent should re-fetch HW
   *  state so the page routes on to integrity / submitted view. */
  onConfirmed: () => void;
}) {
  const [state, setState] = useState<ExtractionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  // Attempts count the server had when the student last kicked off an
  // extraction (initial submit or retake). Polling continues until
  // we see the server's counter tick past this — that's our signal
  // the background task finished the new pass. Null when no
  // extraction is currently in flight from the client's POV.
  const [waitingSinceAttempts, setWaitingSinceAttempts] = useState<number | null>(
    0, // initial submit: server starts at attempts=0, we wait for the first increment
  );
  // Monotonic counter of polls where nothing useful changed; breaks a
  // stuck loop if the background task crashed.
  const [stuckPolls, setStuckPolls] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await schoolStudent.getExtractionStatus(submissionId);
      if (!mounted.current) return;
      setState(res);
    } catch {
      if (!mounted.current) return;
      setError("Couldn't check extraction status. Retrying…");
    }
  }, [submissionId]);

  // A new extraction pass is "in flight" whenever the server's attempts
  // counter hasn't advanced past the point the client last kicked
  // something off. Once the counter moves, we stop waiting — the new
  // state (awaiting_confirmation / pending / unreadable_final) tells
  // us what screen to render.
  const extractionInFlight =
    waitingSinceAttempts !== null &&
    (!state || state.extraction_attempts <= waitingSinceAttempts);

  // Initial fetch + cleanup on unmount.
  useEffect(() => {
    mounted.current = true;
    void fetchStatus();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [fetchStatus]);

  // Polling loop. Re-check every 2s while an extraction could still
  // be in flight. Separately: bump a stuck-polls counter so we can
  // surface a graceful error if nothing moves for too long.
  useEffect(() => {
    if (!extractionInFlight) {
      setStuckPolls(0);
      return;
    }
    if (stuckPolls >= STUCK_POLL_BUDGET) {
      setError(
        "We couldn't finish reading your work — refresh the page to try again.",
      );
      return;
    }
    pollTimer.current = setTimeout(() => {
      void fetchStatus();
      setStuckPolls((n) => n + 1);
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [state, extractionInFlight, stuckPolls, fetchStatus]);

  // When the server's counter ticks past the snapshot, the in-flight
  // extraction finished — clear the waiting flag so subsequent
  // renders / UI decisions use the normal "resting" semantics.
  useEffect(() => {
    if (
      waitingSinceAttempts !== null &&
      state !== null &&
      state.extraction_attempts > waitingSinceAttempts
    ) {
      setWaitingSinceAttempts(null);
    }
  }, [state, waitingSinceAttempts]);

  async function handleConfirm(edited: SubmissionExtraction) {
    setMutating(true);
    setError(null);
    try {
      await schoolStudent.confirmExtraction(submissionId, edited);
      onConfirmed();
    } catch {
      setError("Couldn't save. Please try again.");
      setMutating(false);
    }
  }

  async function handleRetake(imageBase64: string) {
    setMutating(true);
    setError(null);
    try {
      await schoolStudent.retakeSubmission(submissionId, imageBase64);
      // Snapshot the attempts count so the poll loop knows when the
      // new extraction has completed (counter strictly increases).
      if (state) {
        setWaitingSinceAttempts(state.extraction_attempts);
        setStuckPolls(0);
      }
      await fetchStatus();
    } catch {
      setError("Couldn't upload. Please try again.");
    } finally {
      setMutating(false);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────

  // Preparing spinner: initial load, or the client is waiting on a
  // fresh extraction pass to complete (submit or retake).
  if (!state || extractionInFlight) {
    return <PreparingScreen error={error} />;
  }

  if (state.extraction_status === "pending") {
    return (
      <ExtractionRetakeView
        attemptsRemaining={state.attempts_remaining}
        onRetake={handleRetake}
        submitting={mutating}
        error={error}
      />
    );
  }

  if (state.extraction_status === "awaiting_confirmation") {
    return (
      <ExtractionConfirmView
        extraction={state.extraction ?? {}}
        imageDataUrl={imageDataUrl}
        onConfirm={handleConfirm}
        saving={mutating}
        error={error}
      />
    );
  }

  if (state.extraction_status === "unreadable_final") {
    return <ExtractionUnreadableFinalView />;
  }

  // `confirmed` — should have unmounted by now via onConfirmed, but be
  // defensive in case the parent re-mounts us.
  return null;
}

function PreparingScreen({ error }: { error: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <h1 className="text-xl font-bold text-text-primary">
        Reading your work…
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Give us a moment — this usually takes under a minute.
      </p>
      {error && (
        <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
