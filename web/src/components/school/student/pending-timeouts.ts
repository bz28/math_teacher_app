/** Wait-budget policy for the post-submit pending screen.
 *
 *  Split out of `integrity-pending-view.tsx` so it can be exercised
 *  directly: that file is a "use client" React component and can't be
 *  imported by the plain `node --test` runner, which left these numbers —
 *  the ones that decide whether a student is told their homework failed —
 *  with no coverage at all.
 */

/** Which of the two waits the screen is currently sitting in. */
export type Phase = "pre_confirm" | "post_confirm";

/** Vision reading the photos. Production: p50 57.7s, p95 87.2s, slowest
 *  successful read on record 178.8s. The bound sits above that, because a
 *  read that would have succeeded is exactly what must not be abandoned —
 *  two students had homework permanently stranded that way. */
export const EXTRACTION_TIMEOUT_MS = 240_000;

/** Writing the follow-up questions after the student confirms. A
 *  different operation on the same screen and an order of magnitude
 *  quicker: p50 4.1s, slowest on record 19.7s. Holding it to the
 *  extraction bound would park a student on a spinner for four minutes
 *  when this phase genuinely stalls, so it gets its own — still 3x its
 *  worst real run. */
export const QUESTIONS_TIMEOUT_MS = 60_000;

/** When "about a minute" stops being an honest thing to say. */
export const SLOW_AFTER_MS = 75_000;

/** The wait in front of us decides how long it's reasonable to wait.
 *
 *  Phase is unknown until the first poll answers, and an unknown phase
 *  takes the LONGER bound on purpose: guessing short would abandon a
 *  healthy extraction in its first seconds, which is the failure this
 *  whole change exists to stop. Guessing long merely delays an error
 *  screen that is already the unhappy path. */
export function timeoutFor(phase: Phase | null): number {
  return phase === "post_confirm" ? QUESTIONS_TIMEOUT_MS : EXTRACTION_TIMEOUT_MS;
}

/** Whether to swap the "about a minute" line for the honest slow-path one.
 *
 *  Deliberately not just an elapsed-time check. The slow line reassures
 *  the student that a long wait is their dense pages being read — true of
 *  extraction, and a misattribution anywhere else. Post-confirm at this
 *  point is ~18x past its median, which means something has stalled, and
 *  blaming the student's page count for a system fault is both wrong and
 *  no help to them. That phase keeps the neutral line and hits its own
 *  shorter timeout instead. */
export function showsSlowCopy(elapsedMs: number, phase: Phase | null): boolean {
  return elapsedMs >= SLOW_AFTER_MS && phase !== "post_confirm";
}
