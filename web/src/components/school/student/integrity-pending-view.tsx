"use client";

import { useEffect, useRef, useState } from "react";
import { schoolStudent } from "@/lib/api";

interface Props {
  submissionId: string;
  /** Called when the integrity state transitions out of "pending" —
   *  the parent should re-fetch and decide whether to open the chat
   *  (in_progress), show the submitted view (complete / no_check),
   *  or stay on homework. */
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
        const state = await schoolStudent.getIntegrityState(submissionId);
        if (cancelled) return;
        // Any non-extracting state = done waiting. The parent decides
        // what to do next based on the overall_status it sees when
        // it re-fetches.
        if (state.overall_status !== "extracting") {
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
  }, [submissionId]);

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
