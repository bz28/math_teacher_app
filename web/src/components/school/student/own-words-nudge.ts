// When the "answer in your own words" popup opens in the integrity chat.
// Pure so it's unit-testable on plain Node (own-words-nudge.test.ts).

interface NudgeState {
  nudge_own_words: boolean;
  overall_status: string;
}

/** Open only on the reply that turns the server's nudge on: not on resume
 *  (there's no previous state from this session's sends), not again while
 *  the same streak continues, and not once the check has finished. */
export function shouldOpenOwnWordsNudge(
  prev: NudgeState | null,
  next: NudgeState,
): boolean {
  return (
    next.nudge_own_words &&
    !(prev?.nudge_own_words ?? false) &&
    next.overall_status === "in_progress"
  );
}
