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
 * Polling stops as soon as status leaves `pending` OR we hit a
 * terminal state. No WebSockets — 2s polling is plenty for a
 * once-per-submission flow and keeps the server surface small.
 */
const POLL_INTERVAL_MS = 2000;

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

  // Polling loop: re-check status every 2s while extraction is
  // actively running (pending + attempts=0, OR just clicked retake
  // which we track via `mutating`). Stops once the server returns
  // anything else.
  useEffect(() => {
    mounted.current = true;
    void fetchStatus();
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [fetchStatus]);

  useEffect(() => {
    const shouldPoll =
      state !== null &&
      state.extraction_status === "pending" &&
      state.extraction_attempts === 0;
    if (!shouldPoll) return;
    pollTimer.current = setTimeout(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [state, fetchStatus]);

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
      // Optimistically flip local state into "polling" mode — server
      // has kicked off a new extraction, status stays `pending` but
      // attempts_remaining has ticked down. Re-poll immediately.
      setState((s) =>
        s
          ? {
              ...s,
              extraction_status: "pending",
              extraction_attempts: s.extraction_attempts,
              // attempts_remaining doesn't change until the new
              // extraction increments attempts_attempts counter
              // server-side; leave it alone and rely on the next poll.
            }
          : s,
      );
      // Reset attempts to 0 locally so the "preparing" poll loop kicks
      // in. Next poll will bring the real numbers back.
      setState((s) => (s ? { ...s, extraction_attempts: 0 } : s));
      await fetchStatus();
    } catch {
      setError("Couldn't upload. Please try again.");
    } finally {
      setMutating(false);
    }
  }

  if (!state) {
    return <PreparingScreen />;
  }

  if (
    state.extraction_status === "pending" &&
    state.extraction_attempts === 0
  ) {
    return <PreparingScreen />;
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

function PreparingScreen() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <h1 className="text-xl font-bold text-text-primary">
        Reading your work…
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        Give us a moment — this usually takes under a minute.
      </p>
    </div>
  );
}
