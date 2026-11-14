"use client";

import { useEffect, useRef, useState } from "react";
import { schoolStudent } from "@/lib/api";
import {
  type Phase,
  showsSlowCopy,
  timeoutFor,
} from "./pending-timeouts";

interface Props {
  submissionId: string;
  /** Needed so we can poll the submission row directly. Pre-confirm
   *  there's no IntegrityCheckSubmission row yet (integrity + grading
   *  are gated on student confirm), so the integrity-state endpoint
   *  stays stuck at "extracting" even after Vision writes the
   *  extraction. We watch `sub.extraction` landing on the submission
   *  row and fire onReady so the parent can route to the confirm
   *  screen instead of spinning out the full timeout. */
  assignmentId: string;
  /** Called when the wait this view is responsible for has ended:
   *
   *    Pre-confirm:  Vision's extraction has landed on the submission
   *                  row → parent routes to the confirm screen.
   *    Post-confirm: integrity state has moved past "extracting" →
   *                  parent routes to the chat (or wherever the new
   *                  state dictates).
   *
   *  Phase is detected automatically off `extraction_confirmed_at`. */
  onReady: () => void;
  /** Called when the pipeline has not finished within the timeout
   *  window. The parent should show an error with a refresh action. */
  onTimeout: () => void;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Shown between homework submit and the integrity-check chat while
 * the background pipeline (Vision + Sonnet) prepares the follow-up
 * questions. Polls every 3s; gives up after the bound for the phase
 * it's in (see timeoutFor) with an onTimeout callback so the parent
 * can render an error state.
 *
 * This whole screen exists because the integrity pipeline is real LLM
 * work — p50 ~58s, and a dense multi-page submission runs past two
 * minutes — which can't happen inline in the submit request without
 * timing out Railway.
 */
// Phase-aware copy. The view runs through two distinct waits with
// very different operations in flight, so the spinner copy should
// tell the student what's actually happening — generic "preparing"
// is a missed signpost. Detected off `extraction_confirmed_at` (same
// gate the poll uses to decide its done-signal). Until the first
// poll lands we don't know which phase we're in (a refresh on
// post-confirm hits this view too), so we render a phase-neutral
// fallback rather than mislabeling.


const PHASE_COPY: Record<Phase, { title: string; subtitle: string }> = {
  pre_confirm: {
    title: "Analyzing your work",
    subtitle:
      "Reading your steps so you can confirm we got them right.",
  },
  post_confirm: {
    title: "Setting up your chat",
    subtitle: "Writing some questions about your steps.",
  },
};

const NEUTRAL_COPY = {
  title: "Preparing your check",
  subtitle: "Hang tight while we get things ready.",
};

export function IntegrityPendingView({
  submissionId,
  assignmentId,
  onReady,
  onTimeout,
}: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);
  // Until the first poll tells us which wait we're in, render a
  // phase-neutral fallback. Defaulting to pre_confirm misleads on
  // a post-confirm refresh while the first poll is in flight (and
  // worse if the first poll fails: the student sees "Reading your
  // steps so you can confirm we got them right" forever).
  const [phase, setPhase] = useState<Phase | null>(null);

  // Refs for stable callback identities inside the interval closure —
  // we don't want React re-running the poll effect every time a
  // callback prop changes (which would reset the timeout), and
  // we don't want the poll loop to see stale callbacks.
  const onReadyRef = useRef(onReady);
  const onTimeoutRef = useRef(onTimeout);
  // Same reason the poll effect can't depend on `phase`: re-running it
  // would reset `startedAt` and restart the clock every time the phase
  // resolves. The loop reads the phase through a ref, or its closure
  // holds the initial `null` forever and every wait silently gets the
  // extraction bound. Synced in an effect, not during render — writing a
  // ref while rendering is the anti-pattern this file already avoids for
  // the two callbacks above.
  const phaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    onReadyRef.current = onReady;
    onTimeoutRef.current = onTimeout;
    phaseRef.current = phase;
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

        // Flag is terminal regardless of phase — the submission is
        // headed to the teacher for manual grading and there's no
        // further pipeline to wait for.
        if (sub?.extraction_flagged_at != null) {
          onReadyRef.current();
          return;
        }

        // The view serves two distinct waits with different "done"
        // signals. Conflating them (the previous behavior — fire on
        // EITHER extraction-arrived OR state-out-of-extracting) caused
        // a stuck-on-Preparing bug post-confirm: extraction was
        // already on the submission row from the pre-confirm phase,
        // so the very first poll of the post-confirm phase fired
        // onReady → parent re-routed to integrity_pending because
        // state was still "extracting" → polling stopped, student
        // stranded until refresh.
        const confirmed = sub?.extraction_confirmed_at != null;
        // Update the rendered copy as soon as we know the phase.
        // Cheap setState — bails out if value is unchanged.
        setPhase(confirmed ? "post_confirm" : "pre_confirm");
        if (!confirmed) {
          // Pre-confirm: Vision is extracting. Done = extraction
          // lands on the submission row.
          if (sub?.extraction != null) {
            onReadyRef.current();
            return;
          }
        } else {
          // Post-confirm: integrity worker is generating questions.
          // Done = state transitions out of "extracting" (to
          // "awaiting_student" / "in_progress" / a terminal).
          if (state.overall_status !== "extracting") {
            onReadyRef.current();
            return;
          }
        }
      } catch {
        // Transient network errors during polling are fine — we
        // just wait for the next tick. The timeout guard below
        // will catch genuine failures.
      }

      if (Date.now() - startedAt >= timeoutFor(phaseRef.current)) {
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
  const copy = phase == null ? NEUTRAL_COPY : PHASE_COPY[phase];

  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      {/* Pure CSS spinner — no dependency weight on low-end Android.
          motion-reduce removes the spin for students who ask the OS to
          reduce motion; the border ring still reads as a wait state. */}
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary motion-reduce:animate-none" />
      <h1 className="mt-6 text-2xl font-bold text-text-primary">
        {copy.title}…
      </h1>
      <p className="mt-3 text-sm text-text-secondary">{copy.subtitle}</p>
      {/* Anchor expectations to the real budget: promising "about 20
          seconds" while a live counter ticks past it manufactures the
          exact anxiety this screen exists to calm. "About a minute"
          matches extraction's p50 (57.7s).

          Past SLOW_AFTER_MS that promise has visibly expired, and leaving
          it up is worse than replacing it — the student is watching a
          counter contradict the sentence above it. A dense page really can
          take a few minutes now that slow reads are no longer discarded,
          so the honest line is that it's a long one and still running,
          with the reason (their pages are full) so it reads as the system
          working rather than stuck.

          Extraction only. That reassurance is true of a long READ; in the
          post-confirm phase, which is p50 4.1s, 75s means something has
          stalled — and blaming the student's page count for a stall is
          both wrong and unhelpful. That phase keeps the neutral line and
          hits its own shorter timeout instead. */}
      <p className="mt-4 text-xs text-text-muted">
        {showsSlowCopy(elapsedMs, phase)
          ? "Still going — looks like you wrote a lot. Hang tight, this one can take a few minutes."
          : "This usually takes about a minute."}
        {seconds >= 10 && ` (${seconds}s)`}
      </p>
    </div>
  );
}
