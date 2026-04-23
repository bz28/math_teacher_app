"use client";

import { useEffect, useRef, useState } from "react";
import { schoolStudent } from "@/lib/api";

interface Props {
  submissionId: string;
  /** Needed so we can poll the submission row directly. Pre-confirm
   *  there's no IntegrityCheckSubmission row yet (integrity + grading
   *  are gated on student confirm), so the integrity-state endpoint
   *  stays stuck at "extracting" even after Vision writes the
   *  extraction. We watch `sub.extraction` landing on the submission
   *  row and fire onReady so the parent can route to the confirm
   *  screen instead of spinning the full 90s timeout. */
  assignmentId: string;
  /** Called when the pipeline has moved past "extracting" OR when
   *  Vision's extraction has landed on the submission row — whichever
   *  comes first. The parent re-fetches and decides whether to open
   *  the confirm screen, the chat, or the submitted view. */
  onReady: () => void;
  /** Called when the pipeline has not finished within the timeout
   *  window. The parent should show an error with a refresh action. */
  onTimeout: () => void;
}

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 90_000;

/**
 * Shown between homework submit and the integrity-check chat while
 * the background pipeline (Vision + Sonnet) prepares the follow-up
 * questions. Polls every 3s; gives up after 90s with an onTimeout
 * callback so the parent can render an error state.
 *
 * This whole screen exists because the integrity pipeline takes
 * 20–60s of real LLM work and can't run inline in the submit
 * request without timing out Railway.
 */
export function IntegrityPendingView({
  submissionId,
  assignmentId,
  onReady,
  onTimeout,
}: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);

  // Refs for stable callback identities inside the interval closure —
  // we don't want React re-running the poll effect every time a
  // callback prop changes (which would reset the 90s timeout), and
  // we don't want the poll loop to see stale callbacks.
  const onReadyRef = useRef(onReady);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onReadyRef.current = onReady;
    onTimeoutRef.current = onTimeout;
  });

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      if (cancelled) return;
      try {
        // Poll both in parallel: integrity state catches post-confirm
        // transitions, submission row catches pre-confirm extraction
        // arrival (no IntegrityCheckSubmission row exists until the
        // student confirms, so integrity state is stuck at "extracting"
        // during that window).
        const [state, sub] = await Promise.all([
          schoolStudent.getIntegrityState(submissionId),
          schoolStudent.getMySubmission(assignmentId).catch(() => null),
        ]);
        if (cancelled) return;
        const extractionArrived = sub?.extraction != null;
        const flagged = sub?.extraction_flagged_at != null;
        if (
          state.overall_status !== "extracting"
          || extractionArrived
          || flagged
        ) {
          onReadyRef.current();
          return;
        }
      } catch {
        // Transient network errors during polling are fine — we
        // just wait for the next tick. The timeout guard below
        // will catch genuine failures.
      }

      if (Date.now() - startedAt >= TIMEOUT_MS) {
        if (!cancelled) onTimeoutRef.current();
        return;
      }

      setElapsedMs(Date.now() - startedAt);
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    // Kick off immediately so the common "pipeline already finished
    // before this component mounted" case transitions instantly.
    let timer: ReturnType<typeof setTimeout> | undefined;
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [submissionId, assignmentId]);

  const seconds = Math.floor(elapsedMs / 1000);

  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      {/* Pure CSS spinner — no dependency weight on low-end Android */}
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
      <h1 className="mt-6 text-2xl font-bold text-text-primary">
        Preparing your check…
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        Your work has been submitted. We&apos;re just reviewing it so we can
        chat with you about it.
      </p>
      <p className="mt-4 text-xs text-text-muted">
        This usually takes about 20 seconds.
        {seconds >= 10 && ` (${seconds}s)`}
      </p>
    </div>
  );
}
